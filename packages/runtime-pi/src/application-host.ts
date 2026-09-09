import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { relative } from 'node:path';
import { ContainerFailure, resolveTaskPath, taskRelativePath } from '../../container-core/src/index.ts';
import type { ArtifactRef, LocalTaskStore } from '../../container-core/src/index.ts';
import { createPiSessionHost } from './session-host.ts';
import type { PiPluginBinding, PiSession, PiSessionContext, PiSessionHostOptions } from './session-host.ts';

/** Domain assertions supplied by an adapter; the host does not establish domain truth. */
export interface NativePublication {
  type: string;
  version: string;
  path: string;
  verification_status: string;
}

export interface PiApplicationContext extends PiSessionContext { task_id: string }

export interface PiApplicationAdapter extends PiPluginBinding {
  initialize?(context: PiApplicationContext, artifacts: readonly ArtifactRef[]): Promise<void>;
  run?(session: PiSession, context: PiApplicationContext): Promise<readonly NativePublication[]>;
}

export interface PiApplicationHostOptions extends Omit<PiSessionHostOptions,
  'expectedVersion' | 'bindings' | 'initialize' | 'run' | 'observe'> {
  store: LocalTaskStore;
  /** Application native.binding_key -> reusable adapter. */
  adapters: Readonly<Record<string, PiApplicationAdapter>>;
}

/** Shared composition, lifecycle observations and publication provenance for Pi applications. */
export function createPiApplicationHost(options: PiApplicationHostOptions) {
  const { store, adapters } = options;
  const bindings: Record<string, PiPluginBinding> = {};
  for (const plugin of store.task.application.plugins) {
    const adapter = adapters[plugin.native.binding_key];
    if (!adapter) throw new ContainerFailure('NativeIntegrationNotReady', 'Application adapter is missing.');
    bindings[plugin.id] = { entry: adapter.entry, ...(adapter.prompt_paths ? { prompt_paths: adapter.prompt_paths } : {}) };
    if (plugin.role === 'domain' && (!adapter.initialize || !adapter.run)) {
      throw new ContainerFailure('NativeIntegrationNotReady', 'Domain adapter needs initialization and execution.');
    }
  }
  const primary = (context: PiSessionContext) => {
    const plugin = store.task.application.plugins.find(p => p.id === context.plan.primary_plugin_id);
    if (!plugin) throw new ContainerFailure('NativeIntegrationNotReady', 'This host requires a primary adapter.');
    return adapters[plugin.native.binding_key]!;
  };
  const domainContext = (context: PiSessionContext): PiApplicationContext => ({ ...context, task_id: store.task.id });
  const observe = async (event: string, context: PiSessionContext) => {
    const session = await store.getSession(context.session_id);
    await store.appendEvent({ id: randomUUID(), type: `runtime.pi.${event}`, timestamp: new Date().toISOString(),
      task_id: store.task.id, session_id: session.id, actor_id: session.actor.id,
      source: 'runtime-pi', correlation_id: session.id, payload: {} });
  };
  const rejection = async (event: string, context: PiSessionContext) => {
    try { await observe(event, context); } catch { /* preserve the native failure */ }
  };
  return createPiSessionHost({ ...options, bindings, expectedVersion: store.task.application.runtime.version,
    async initialize(context, artifacts) {
      try { await primary(context).initialize!(domainContext(context), artifacts); }
      catch (error) { await rejection('initialization-rejected', context); throw error; }
    },
    observe,
    async run(session, context) {
      let publications: readonly NativePublication[];
      try { publications = await primary(context).run!(session, domainContext(context)); }
      catch (error) { await rejection('execution-rejected', context); throw error; }
      const producer = await store.getSession(context.session_id);
      for (const publication of publications) {
        const path = await realpath(resolveTaskPath(store.taskRoot, publication.path));
        // A task-relative spelling must not hide an escaping symlink.
        taskRelativePath(relative(await realpath(store.taskRoot), path).replaceAll('\\', '/'));
        const digest = createHash('sha256').update(await readFile(path)).digest('hex');
        await store.publishArtifact({ id: randomUUID(), task_id: store.task.id,
          type: publication.type, version: publication.version,
          producer: { plugin_id: producer.primary_plugin_id!, capability_id: 'native-publication', session_id: producer.id },
          executor: { actor_id: producer.actor.id, runtime_id: producer.runtime.id },
          verification: { status: publication.verification_status },
          payload_ref: { kind: 'file', path: publication.path }, sha256: digest, created_at: new Date().toISOString() });
      }
      return { status: 'completed' };
    },
  });
}
