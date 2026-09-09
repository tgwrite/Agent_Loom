import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { ContainerFailure } from '../../container-core/src/index.ts';
import type { ArtifactRef, NativeSessionHandle, SessionHost, SessionPlan } from '../../container-core/src/index.ts';

/** The small SDK surface exercised by the bridge; the SDK is supplied locally. */
export interface PiSession {
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  bindExtensions(options: { mode: 'rpc'; onError(error: unknown): void }): Promise<void>;
  extensionRunner: { emit(event: { type: 'session_shutdown'; reason: 'exit' }): Promise<unknown> };
  dispose(): void;
}

export interface PiSdk {
  SettingsManager: { inMemory(settings: Record<string, unknown>): unknown };
  SessionManager: { create(cwd: string, sessionDir: string): { getSessionId(): string } };
  DefaultResourceLoader: new (options: Record<string, unknown>) => {
    reload(): Promise<void>;
    getExtensions(): { errors: readonly unknown[]; extensions: readonly { resolvedPath: string }[] };
  };
  createAgentSession(options: Record<string, unknown>): Promise<{ session: PiSession }>;
}

export interface PiPluginBinding {
  /** An explicit native entry file. Global extension discovery is disabled. */
  entry: string;
  prompt_paths?: readonly string[];
}

export interface PiSessionContext {
  plan: SessionPlan;
  workspace: string;
  session_id: string;
  task_root: string;
}

/** Native content and stack traces never cross this boundary. */
export interface PiFailureOrigin { plugin_id?: string; phase: string }
const nativePhases = new Set(['session_start', 'session_shutdown', 'agent_start', 'agent_end', 'agent_settled',
  'turn_start', 'turn_end', 'message_start', 'message_update', 'message_end', 'tool_execution_start',
  'tool_execution_update', 'tool_execution_end', 'tool_call', 'tool_result', 'context', 'before_agent_start',
  'session_before_compact', 'session_compact', 'session_compact_failed']);

export interface PiSessionHostOptions {
  /** Accepts the locally imported SDK module without requiring a public dependency. */
  sdk: unknown;
  /** Version read from the selected SDK installation, not inferred from configuration. */
  sdkVersion: string;
  expectedVersion: string;
  agentDir: string;
  /** Local settings snapshot; no global settings are modified. */
  settings: Record<string, unknown>;
  modelRuntime: unknown;
  /** Keys are Application Plugin IDs. */
  bindings: Readonly<Record<string, PiPluginBinding>>;
  /** Native adapters prepare the workspace and verify every supplied Artifact. */
  initialize(context: PiSessionContext, artifacts: readonly ArtifactRef[]): Promise<void>;
  /** The driver resolves only after native execution stops. */
  run(session: PiSession, context: PiSessionContext): ReturnType<NativeSessionHandle['run']>;
  /** Only lifecycle names and bound origin cross this boundary, never raw native events. */
  observe?(event: 'started' | 'shutdown' | 'extension-error' | 'aspect-error', context: PiSessionContext,
    origin?: PiFailureOrigin): Promise<void>;
  /** Flush required governance writes after shutdown and before terminal settlement. */
  finalize?(context: PiSessionContext): Promise<void>;
}

function unavailable(): ContainerFailure {
  return new ContainerFailure('NativeIntegrationNotReady', 'Pi SDK or selected Plugin binding is unavailable.');
}

function nativeFailure(): ContainerFailure {
  return new ContainerFailure('NativeExecutionFailed', 'Native Pi session failed.');
}

/**
 * Native initialization precedes resource loading, so generated workspace instructions
 * are visible to Pi. Core records consumption only after initialize() completes.
 * A driver and real domain initializer are mandatory; this is not an acceptance claim.
 */
export function createPiSessionHost(options: PiSessionHostOptions): SessionHost {
  const sdk = options.sdk as PiSdk | undefined;
  if (!sdk || typeof sdk.SettingsManager?.inMemory !== 'function'
    || typeof sdk.SessionManager?.create !== 'function' || typeof sdk.DefaultResourceLoader !== 'function'
    || typeof sdk.createAgentSession !== 'function') throw unavailable();
  // Freeze caller-owned configuration while keeping the supplied SDK/service objects.
  const bindings = structuredClone(options.bindings);
  const settings = structuredClone(options.settings);
  const pathKey = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
  const entryOwners = new Map<string, string>();
  // Package/resource discovery is controlled by the selected Profile only.
  for (const key of ['packages', 'extensions', 'skills', 'prompts', 'themes']) delete settings[key];
  async function validate(plan: SessionPlan): Promise<void> {
    if (options.sdkVersion !== options.expectedVersion || !isAbsolute(options.agentDir)
      || typeof options.initialize !== 'function' || typeof options.run !== 'function') throw unavailable();
    try {
      const entries = new Set<string>();
      for (const id of plan.plugin_ids) {
        const binding = bindings[id];
        if (!binding || !isAbsolute(binding.entry) || !(await stat(binding.entry)).isFile()) throw unavailable();
        entryOwners.set(pathKey(binding.entry), id);
        binding.entry = await realpath(binding.entry);
        const key = pathKey(binding.entry);
        if (entries.has(key)) throw unavailable();
        entries.add(key);
        entryOwners.set(key, id);
        for (const prompt of binding.prompt_paths ?? []) {
          if (!isAbsolute(prompt) || !(await stat(prompt)).isDirectory()) throw unavailable();
        }
      }
    } catch { throw unavailable(); }
  }
  return {
    runtime: { id: 'pi', name: 'pi', version: options.sdkVersion },
    validate,
    async launch(plan, workspace, binding) {
      await validate(plan);
      const context: PiSessionContext = { plan: structuredClone(plan), workspace,
        session_id: binding.session_id, task_root: binding.task_root };
      const snapshot = () => structuredClone(context);
      const sessionManager = sdk.SessionManager.create(workspace,
        resolve(binding.task_root, '.agent-loom', 'native-sessions', binding.session_id));
      let session: PiSession | undefined;
      let initialized = false;
      let attempted = false;
      let running = false;
      let closed = false;
      let extensionFailed = false;
      let observations = Promise.resolve();
      const observe = (event: 'started' | 'shutdown' | 'extension-error' | 'aspect-error', origin?: PiFailureOrigin) => {
        // An optional observer cannot fail or change native execution.
        observations = observations.then(async () => {
          try { await options.observe?.(event, snapshot(), origin); } catch { /* observer isolation */ }
        });
        return observations;
      };
      const close = async () => {
        if (closed) return;
        closed = true;
        if (!session) return;
        try {
          await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' });
          await observe('shutdown');
          if (extensionFailed) throw nativeFailure();
        } finally {
          try { await observations; await options.finalize?.(snapshot()); }
          finally { session.dispose(); }
        }
      };
      return {
        runtime_session_id: sessionManager.getSessionId(),
        async initialize(artifacts) {
          if (attempted || closed || JSON.stringify(artifacts) !== JSON.stringify(context.plan.artifacts)) throw nativeFailure();
          attempted = true;
          try {
            await options.initialize(snapshot(), structuredClone(artifacts));
            const settingsManager = sdk.SettingsManager.inMemory(structuredClone(settings));
            const selected = context.plan.plugin_ids.map(id => bindings[id]!);
            const loader = new sdk.DefaultResourceLoader({ cwd: workspace, agentDir: options.agentDir,
              settingsManager, noExtensions: true, noSkills: true, noThemes: true,
              noPromptTemplates: true, additionalExtensionPaths: selected.map(item => item.entry),
              additionalPromptTemplatePaths: selected.flatMap(item => [...(item.prompt_paths ?? [])]),
            });
            await loader.reload();
            const loaded = loader.getExtensions();
            const expectedEntries = new Set(selected.map(item => pathKey(item.entry)));
            if (loaded.errors.length || loaded.extensions.length !== expectedEntries.size
              || loaded.extensions.some(item => !expectedEntries.delete(pathKey(item.resolvedPath)))
              || expectedEntries.size !== 0) throw nativeFailure();
            ({ session } = await sdk.createAgentSession({ cwd: workspace, agentDir: options.agentDir,
              settingsManager, sessionManager, resourceLoader: loader, modelRuntime: options.modelRuntime }));
            await session.bindExtensions({ mode: 'rpc', onError(error) {
              const nativePath = typeof error === 'object' && error !== null && 'extensionPath' in error
                && typeof error.extensionPath === 'string' ? error.extensionPath : undefined;
              const owner = nativePath === undefined ? undefined : entryOwners.get(pathKey(nativePath));
              const isAspect = owner !== undefined && context.plan.aspect_plugin_ids.includes(owner);
              if (!isAspect) extensionFailed = true;
              const event = typeof error === 'object' && error !== null && 'event' in error ? error.event : undefined;
              const phase = typeof event === 'string' && nativePhases.has(event) ? event : 'unknown';
              void observe(isAspect ? 'aspect-error' : 'extension-error', { ...(owner ? { plugin_id: owner } : {}), phase });
            } });
            await observations;
            if (extensionFailed) throw nativeFailure();
            await observe('started');
            initialized = true;
          } catch { throw nativeFailure(); }
        },
        async run() {
          if (!initialized || running || closed || !session) throw nativeFailure();
          running = true;
          try {
            const result = await options.run(session, snapshot());
            if (extensionFailed) throw nativeFailure();
            return result;
          } catch { throw nativeFailure(); }
        },
        close,
      };
    },
  };
}
