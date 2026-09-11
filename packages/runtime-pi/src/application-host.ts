import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { relative } from 'node:path';
import { ContainerFailure, diagnosticFor, resolveProfile, resolveTaskPath, taskRelativePath, recordParticipantObservation, safeNativeFailure } from '../../container-core/src/index.ts';
import type { ArtifactRef, ArtifactProducerPhase, LocalTaskStore, ObserverFailureContext, AgentRequest, SessionPlan } from '../../container-core/src/index.ts';
import { createPiSessionHost } from './session-host.ts';
import type { PiFailureOrigin, PiPluginBinding, PiSession, PiSessionContext, PiSessionHostOptions } from './session-host.ts';

/** Domain assertions supplied by an adapter; the host does not establish domain truth. */
export interface NativePublication {
  type: string;
  version: string;
  path: string;
  verification_status: string;
}

export interface PiApplicationContext extends PiSessionContext { task_id: string; request?: AgentRequest }

export interface PiApplicationAdapter extends PiPluginBinding {
  request_mapping?: 'v1';
  initialize?(context: PiApplicationContext, artifacts: readonly ArtifactRef[]): Promise<void>;
  run?(session: PiSession, context: PiApplicationContext): Promise<readonly NativePublication[]>;
  /** Optional explicit aspect phase, after domain execution, before native shutdown.
   * Native hooks remain owned by Pi. An adapter failure is attributed and contained. */
  afterRun?(session: PiSession, context: PiApplicationContext, outcome: 'completed' | 'failed'): Promise<readonly NativePublication[]>;
}

export interface PiApplicationHostOptions extends Omit<PiSessionHostOptions,
  'expectedVersion' | 'bindings' | 'initialize' | 'run' | 'observe' | 'finalize'> {
  store: LocalTaskStore;
  /** Application native.binding_key -> reusable adapter. */
  adapters: Readonly<Record<string, PiApplicationAdapter>>;
}

/** Shared composition, lifecycle observations and publication provenance for Pi applications. */
export function createPiApplicationHost(options: PiApplicationHostOptions) {
  // A fresh writer and adapter selection belong to each launched Session.
  const select = (plan: SessionPlan) => createSelectedHost(options, plan.profile_id);
  return {
    runtime: { id: 'pi', name: 'pi', version: options.sdkVersion }, request_mapping: 'v1' as const,
    async validate(plan: SessionPlan) { await select(plan).validate(plan); },
    async launch(...args: Parameters<ReturnType<typeof createPiSessionHost>['launch']>) {
      return select(args[0]).launch(...args);
    },
  };
}

function createSelectedHost(options: PiApplicationHostOptions, profileId: string) {
  const { store, adapters } = options;
  const bindings: Record<string, PiPluginBinding> = {};
  for (const plugin of resolveProfile(store.task.application, profileId).plugins) {
    const adapter = adapters[plugin.native.binding_key];
    if (!adapter) continue;
    bindings[plugin.id] = { entry: adapter.entry, ...(adapter.prompt_paths ? { prompt_paths: adapter.prompt_paths } : {}) };
  }
  const primary = (context: PiSessionContext) => {
    const plugin = store.task.application.plugins.find(p => p.id === context.plan.primary_plugin_id);
    if (!plugin) throw new ContainerFailure('NativeIntegrationNotReady', 'This host requires a primary adapter.');
    return adapters[plugin.native.binding_key]!;
  };
  const domainContext = (context: PiSessionContext, requestAllowed = true): PiApplicationContext => {
    const clone = structuredClone(context);
    if (!requestAllowed) delete clone.plan.request;
    return { ...clone, task_id: store.task.id,
      ...(requestAllowed && clone.plan.request ? { request: structuredClone(clone.plan.request) } : {}) };
  };
  // Pi callbacks and explicit aspect phases share a single governance writer.
  // A storage rejection remains sticky and is surfaced before terminal settlement.
  let writes: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = writes.then(operation);
    writes = next;
    void next.catch(() => {});
    return next;
  };
  const aspectFailure = (context: PiSessionContext, pluginId: string, phase: string,
    failureClass: ObserverFailureContext['failure_class'], error?: unknown) =>
    store.recordObserverFailure(context.session_id, pluginId, { code: 'NativeAspectFailed',
      message: `Native aspect failed during ${phase}.`, source: pluginId, timestamp: new Date().toISOString(),
      diagnostic: diagnosticFor(error, 'aspect') },
    { phase, failure_class: failureClass });
  const observe = (event: string, context: PiSessionContext, origin?: PiFailureOrigin) => enqueue(async () => {
    const session = await store.getSession(context.session_id);
    await store.appendEvent({ id: randomUUID(), type: `runtime.pi.${event}`, timestamp: new Date().toISOString(),
      task_id: store.task.id, session_id: session.id, actor_id: session.actor.id,
      source: 'runtime-pi', correlation_id: session.id, payload: origin ? { ...origin } : {} });
    if ((event === 'domain-completed' || event === 'execution-rejected') && session.primary_plugin_id)
      await recordParticipantObservation(store, session.id, { plugin_id: session.primary_plugin_id, phase: 'domain-run',
        status: event === 'domain-completed' ? 'completed' : 'failed' });
    if ((event === 'aspect-started' || event === 'aspect-completed') && origin?.plugin_id)
      await recordParticipantObservation(store, session.id, { plugin_id: origin.plugin_id, phase: 'aspect-after-run',
        status: event === 'aspect-started' ? 'started' : 'completed' });
    if (event === 'aspect-error' && origin?.plugin_id) await aspectFailure(context, origin.plugin_id, origin.phase, 'native-hook');
  });
  const rejection = async (event: string, context: PiSessionContext) => {
    try { await observe(event, context); } catch { /* preserve the native failure */ }
  };
  const publish = async (context: PiSessionContext, pluginId: string, publications: readonly NativePublication[],
    producerPhase: ArtifactProducerPhase) => {
    const producer = await store.getSession(context.session_id);
    if (!producer.runtime_session_id) throw new ContainerFailure('InvalidRecord', 'Native producer Session identity is missing.');
    const nativeSessionId = producer.runtime_session_id;
    // Validate and read the whole batch before registering any of it.
    const records = await Promise.all(publications.map(async publication => {
      const plugin = store.task.application.plugins.find(p => p.id === pluginId);
      if (!context.plan.plugin_ids.includes(pluginId)
        || !plugin?.produces?.some(p => p.type === publication.type && p.version === publication.version)
        || typeof publication.verification_status !== 'string' || !publication.verification_status.trim()) {
        throw new ContainerFailure('InvalidRecord', 'Native publication contract or verification is invalid.');
      }
      const path = await realpath(resolveTaskPath(store.taskRoot, publication.path));
      taskRelativePath(relative(await realpath(store.taskRoot), path).replaceAll('\\', '/'));
      return { publication, digest: createHash('sha256').update(await readFile(path)).digest('hex') };
    }));
    for (const { publication, digest } of records) await enqueue(async () => {
      try { await store.publishArtifact({ id: randomUUID(), task_id: store.task.id,
      type: publication.type, version: publication.version,
      producer: { plugin_id: pluginId, capability_id: 'native-publication', session_id: producer.id },
      producer_phase: producerPhase, native_runtime_session_id: nativeSessionId,
      executor: { actor_id: producer.actor.id, runtime_id: producer.runtime.id },
      verification: { status: publication.verification_status }, payload_ref: { kind: 'file', path: publication.path },
      sha256: digest, created_at: new Date().toISOString() }); }
      catch (error) {
        if (context.plan.aspect_plugin_ids.includes(pluginId)) {
          // The same writer may retain a diagnostic if storage is still usable.
          // A failed write remains fatal even when the diagnostic can be saved.
          try { await aspectFailure(context, pluginId, 'after-run', 'governance-storage'); } catch { /* storage unavailable */ }
        }
        throw error;
      }
    });
  };
  const host = createPiSessionHost({ ...options, bindings, expectedVersion: store.task.application.runtime.version,
    async initialize(context, artifacts) {
      try { await primary(context).initialize!(domainContext(context), artifacts); }
      catch (error) {
        await rejection('initialization-rejected', context);
        throw safeNativeFailure(error, { phase: 'initialization',
          ...(context.plan.primary_plugin_id ? { plugin_id: context.plan.primary_plugin_id } : {}) });
      }
    },
    observe,
    async finalize() { await writes; },
    async run(session, context) {
      let outcome: 'completed' | 'failed' = 'completed';
      let domainError: unknown;
      let phase: 'domain-run' | 'publication' = 'domain-run';
      try {
        const publications = await primary(context).run!(session, domainContext(context));
        phase = 'publication';
        await publish(context, context.plan.primary_plugin_id!, publications, 'domain-run');
        await observe('domain-completed', context);
      } catch (error) {
        outcome = 'failed';
        domainError = safeNativeFailure(error, { phase,
          ...(context.plan.primary_plugin_id ? { plugin_id: context.plan.primary_plugin_id } : {}) });
        await rejection('execution-rejected', context);
      }
      for (const pluginId of context.plan.aspect_plugin_ids) {
        const plugin = store.task.application.plugins.find(p => p.id === pluginId)!;
        const adapter = adapters[plugin.native.binding_key]!;
        if (!adapter.afterRun) continue;
        await observe('aspect-started', context, { plugin_id: pluginId, phase: 'after-run' });
        let failureClass: ObserverFailureContext['failure_class'] = 'aspect-execution';
        try {
          const publications = await adapter.afterRun(session, domainContext(context, adapter.request_mapping === 'v1'), outcome);
          failureClass = 'publication-validation';
          await publish(context, pluginId, publications, 'aspect-after-run');
        } catch (error) {
          await writes; // A rejected governance write must not become an optional aspect failure.
          await enqueue(() => aspectFailure(context, pluginId, 'after-run', failureClass, error));
          continue;
        }
        await observe('aspect-completed', context, { plugin_id: pluginId, phase: 'after-run' });
      }
      await writes;
      if (outcome === 'failed') throw domainError;
      return { status: 'completed' };
    },
  });
  const validate = async (plan: SessionPlan) => {
    for (const plugin of resolveProfile(store.task.application, plan.profile_id).plugins) {
      const adapter = adapters[plugin.native.binding_key];
      if (!adapter || (plugin.role === 'domain' && (!adapter.initialize || !adapter.run)))
        throw new ContainerFailure('NativeIntegrationNotReady', 'Selected adapter is missing initialization or execution.');
      if (plan.request && plugin.role === 'domain' && adapter.request_mapping !== 'v1')
        throw new ContainerFailure('NativeIntegrationNotReady', 'Selected adapter does not support invocation mapping.');
    }
    await host.validate(plan);
  };
  return { ...host, request_mapping: 'v1' as const, validate,
    async launch(...args: Parameters<typeof host.launch>) { await validate(args[0]); return host.launch(...args); } };

}
