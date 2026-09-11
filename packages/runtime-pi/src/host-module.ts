import { mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ContainerFailure, resolveProfile, validateApplication } from '../../container-core/src/index.ts';
import type { ApplicationDefinition, LocalTaskStore, SessionPlan, SessionHost, PluginDescriptor, SessionProfile } from '../../container-core/src/index.ts';
import { createPiApplicationHost } from './application-host.ts';
import type { PiApplicationAdapter } from './application-host.ts';
import { createPiSessionHost } from './session-host.ts';
import type { PiPluginBinding, PiSdk } from './session-host.ts';

export type PiAdapterHooks = Pick<PiApplicationAdapter, 'initialize' | 'run' | 'afterRun'>;
export interface PiAdapterRegistration extends PiPluginBinding {
  request_mapping?: 'v1';
  /** Runs only for selected participants at launch, never when opening or validating a Host. */
  create?(context: { store: LocalTaskStore; plan: SessionPlan }): PiAdapterHooks | Promise<PiAdapterHooks>;
}
export interface PiHostModuleOptions {
  sdk: unknown;
  sdkVersion: string;
  /** Application binding keys; explicit local entries are shared by preflight and execution. */
  adapters: Readonly<Record<string, PiAdapterRegistration>>;
  /** Trusted local configuration. Credentials and provider policy remain with the application. */
  configure(context: { store: LocalTaskStore }): {
    settings: Record<string, unknown>; modelRuntime: unknown;
  } | Promise<{ settings: Record<string, unknown>; modelRuntime: unknown }>;
  /** Explicit local directory used by resource preflight, outside domain workspaces. */
  preflightDirectory: string;
}

/** Reusable CLI Host exports. Does not install Plugins, select a model, or schedule Profiles. */
export function createPiHostModule(options: PiHostModuleOptions) {
  const registrations = Object.fromEntries(Object.entries(options.adapters).map(([key, value]) =>
    [key, { ...value, ...(value.prompt_paths ? { prompt_paths: [...value.prompt_paths] } : {}) }]));
  const bindingsFor = (application: ApplicationDefinition, profileId?: string) => {
    validateApplication(application);
    if (application.runtime.id !== 'pi' || application.runtime.version !== options.sdkVersion)
      throw new ContainerFailure('NativeIntegrationNotReady', 'Pi SDK version does not match the Application.', { check: 'sdk-version' });
    return Object.fromEntries((profileId ? resolveProfile(application, profileId).plugins : application.plugins).map(plugin => {
      const registration = registrations[plugin.native.binding_key];
      if (!registration || (plugin.role === 'domain' && typeof registration.create !== 'function'))
        throw new ContainerFailure('NativeIntegrationNotReady', 'Plugin adapter registration is missing.',
          { check: 'adapter-registration', plugin_id: plugin.id, binding_key: plugin.native.binding_key });
      return [plugin.id, { entry: registration.entry,
        ...(registration.prompt_paths ? { prompt_paths: registration.prompt_paths } : {}) }];
    }));
  };
  return {
    async validateNativeApplication({ application }: { application: ApplicationDefinition }): Promise<void> {
      const bindings = bindingsFor(application);
      const agentDir = resolve(options.preflightDirectory);
      // Reuse the production binding checks. These throwing callbacks must never execute here.
      const unexpected = async (): Promise<never> => { throw new Error('Preflight cannot execute a Session'); };
      const host = createPiSessionHost({ sdk: options.sdk, sdkVersion: options.sdkVersion,
        expectedVersion: application.runtime.version, agentDir, bindings, settings: {}, modelRuntime: undefined,
        initialize: unexpected, run: unexpected });
      const sdk = options.sdk as PiSdk;
      for (const profile of application.profiles) {
        const { plugins } = resolveProfile(application, profile.id);
        const plan: SessionPlan = { task_id: 'preflight', profile_id: profile.id,
          workspace: profile.workspace ?? '.', plugin_ids: plugins.map(p => p.id),
          aspect_plugin_ids: [...profile.aspects], artifacts: [],
          ...(profile.primary ? { primary_plugin_id: profile.primary } : {}) };
        await host.validate(plan);
        const selected = plugins.map(plugin => bindings[plugin.id]!);
        const expected = await Promise.all(selected.map(binding => realpath(binding.entry)));
        const loader = new sdk.DefaultResourceLoader({ cwd: agentDir, agentDir,
          settingsManager: sdk.SettingsManager.inMemory({}), noExtensions: true, noSkills: true,
          noThemes: true, noPromptTemplates: true, noContextFiles: true,
          additionalExtensionPaths: expected,
          additionalPromptTemplatePaths: selected.flatMap(binding => [...(binding.prompt_paths ?? [])]) });
        await loader.reload();
        const loaded = loader.getExtensions();
        const key = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
        const pending = new Set(expected.map(key));
        if (loaded.errors.length || loaded.extensions.length !== pending.size
          || loaded.extensions.some(extension => !pending.delete(key(extension.resolvedPath))) || pending.size)
          throw new ContainerFailure('NativeIntegrationNotReady', 'Selected native extensions did not load exactly.',
            { check: 'extension-loading', profile_id: profile.id });
      }
    },
    async createSessionHost({ store }: { store: LocalTaskStore }): Promise<SessionHost> {
      const application = store.task.application;
      const agentDir = join(store.taskRoot, '.agent-loom', 'pi');
      const validate = async (plan: SessionPlan) => {
        const bindings = bindingsFor(application, plan.profile_id);
        const { plugins } = resolveProfile(application, plan.profile_id);
        if (plan.request && plugins.some(plugin => plugin.role === 'domain'
          && registrations[plugin.native.binding_key]?.request_mapping !== 'v1'))
          throw new ContainerFailure('NativeIntegrationNotReady', 'Selected adapter does not support invocation mapping.');
        const unexpected = async (): Promise<never> => { throw new Error('Validation cannot execute a Session'); };
        await createPiSessionHost({ sdk: options.sdk, sdkVersion: options.sdkVersion,
          expectedVersion: application.runtime.version, agentDir, bindings, settings: {}, modelRuntime: undefined,
          initialize: unexpected, run: unexpected }).validate(plan);
      };
      return {
        runtime: { id: 'pi', name: 'pi', version: options.sdkVersion }, request_mapping: 'v1', validate,
        async launch(plan, workspace, binding) {
          await validate(plan);
          const bindings = bindingsFor(application, plan.profile_id);
          const config = await options.configure({ store });
          const adapters: Record<string, PiApplicationAdapter> = {};
          for (const plugin of resolveProfile(application, plan.profile_id).plugins) {
            const registration = registrations[plugin.native.binding_key]!;
            const scoped = structuredClone(plan);
            if (plugin.role === 'aspect' && registration.request_mapping !== 'v1') delete scoped.request;
            adapters[plugin.native.binding_key] = {
              ...await registration.create?.({ store, plan: scoped }), ...bindings[plugin.id]!,
              ...(registration.request_mapping ? { request_mapping: registration.request_mapping } : {}),
            };
          }
          await mkdir(agentDir, { recursive: true });
          const host = createPiApplicationHost({ ...config, store, sdk: options.sdk,
            sdkVersion: options.sdkVersion, agentDir, adapters });
          return host.launch(plan, workspace, binding);
        },
      };
    },
  };
}

/** One trusted Module supplies descriptor data and the corresponding local registration. */
export function definePiApplicationModule(options: Omit<PiHostModuleOptions, 'adapters'> & {
  id: string; version: string;
  plugins: readonly { descriptor: PluginDescriptor; adapter: PiAdapterRegistration }[];
  profiles: readonly SessionProfile[];
}) {
  const application: ApplicationDefinition = { id: options.id, version: options.version,
    runtime: { id: 'pi', version: options.sdkVersion },
    plugins: options.plugins.map(plugin => structuredClone(plugin.descriptor)),
    profiles: structuredClone(options.profiles) };
  validateApplication(application);
  const adapters: Record<string, PiAdapterRegistration> = {};
  for (const plugin of options.plugins) {
    const key = plugin.descriptor.native.binding_key;
    if (Object.hasOwn(adapters, key)) throw new ContainerFailure('BindingConflict', 'Module binding keys must be unique.');
    adapters[key] = plugin.adapter;
  }
  return { application, ...createPiHostModule({ ...options, adapters }) };
}
