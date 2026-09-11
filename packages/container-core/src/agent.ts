import { randomUUID } from 'node:crypto';
import type { ApplicationDefinition } from './application/index.ts';
import { validateApplication } from './application/index.ts';
import { ContainerFailure } from './failure/index.ts';
import { diagnosticFor } from './failure/diagnostic.ts';
import type { SafeDiagnostic } from './failure/diagnostic.ts';
import { inspectTask, taskInspectionView } from './inspection.ts';
import { consumedInputs, receiptFromSession, requestedInputs } from './agent-receipt.ts';
import type { AgentReceipt } from './agent-receipt.ts';
export type { AgentReceipt } from './agent-receipt.ts';
import { executeSession, prepareSession } from './governance.ts';
import type { SessionHost, SessionPlan } from './governance.ts';
import { LocalTaskStore } from './storage/index.ts';
import { invocationRequirements, validateRequest, requestSchema } from './invocation.ts';
import type { AgentRequest } from './invocation.ts';
import type { ActorRef } from './actor/index.ts';
import type { SessionProfile } from './session/index.ts';

export type { AgentRequest, EntryContract } from './invocation.ts';
export interface DiscoveryFilter { id?: string; name?: string; tag?: string; input_type?: string; output_type?: string }

function profileFor(application: ApplicationDefinition, entryId: string): SessionProfile {
  const profile = application.profiles.find(p => (p.entry?.id ?? p.id) === entryId);
  if (!profile) throw new ContainerFailure('InvalidArguments', 'Entry is not declared in this Application.');
  return profile;
}

/** Pure data projection; importing a user-supplied Application module is a separate operation. */
export function describeEntry(application: ApplicationDefinition, entryId: string) {
  validateApplication(application);
  const profile = profileFor(application, entryId);
  const entry = profile.entry;
  const primary = application.plugins.find(p => p.id === profile.primary);
  return structuredClone({ schema_version: 1 as const, entry_id: entry?.id ?? profile.id, profile_id: profile.id,
    name: entry?.name ?? profile.id, purpose: entry?.purpose ?? 'Execute this declared Session Profile.',
    tags: entry?.tags ?? [], implementation: entry?.implementation ?? 'unknown',
    inputs: profile.requirements, outputs: primary?.produces ?? [], output_scope: 'primary-plugin-declarations',
    execution_scope: 'new-session', business_validator: 'application-owned',
    request_mapping: entry?.request_mapping ?? 'unsupported',
    effect_declarations: entry?.effect_declarations ?? [], effects_enforcement: 'unknown',
    retry_safety: 'not-guaranteed', examples: entry?.examples ?? [],
    participants: { primary: profile.primary ?? null, aspects: profile.aspects },
    request_schema: requestSchema(profile),
    parameter_validation: { envelope: 'schema-v1', data: 'application-owned', hard_limits: 'unsupported' } });
}

export function discoverEntries(application: ApplicationDefinition, filter: DiscoveryFilter = {}) {
  validateApplication(application);
  return { schema_version: 1 as const, application_id: application.id,
    entries: application.profiles.map(p => describeEntry(application, p.entry?.id ?? p.id))
      .filter(e => (!filter.id || e.entry_id === filter.id)
        && (!filter.name || e.name.toLowerCase().includes(filter.name.toLowerCase()))
        && (!filter.tag || e.tags.includes(filter.tag))
        && (!filter.input_type || e.inputs.some(i => i.type === filter.input_type))
        && (!filter.output_type || e.outputs.some(o => o.type === filter.output_type)))
      .map(e => ({ entry_id: e.entry_id, purpose: e.purpose, inputs: e.inputs.map(i => ({ name: i.input_name ?? null, type: i.type, version: i.version })),
        outputs: e.outputs, implementation: e.implementation })) };
}

export interface AgentHostBinding {
  delivery?: 'declared' | 'invalid';
  /** Trusted binding identity; request payload cannot replace it. */
  actor: ActorRef;
  createHost(context: { store: LocalTaskStore; plan: SessionPlan }): SessionHost | Promise<SessionHost>;
  /** Optional trusted read-only registration check. Must not instantiate adapters. */
  checkBindings?(plan: SessionPlan): Promise<void>;
  /** Explicit opt-in; may import native resources. Never implies model/credential validation. */
  nativePreflight?(plan: SessionPlan): Promise<void>;
}
export interface AgentConnectionOptions {
  taskRoot: string;
  taskId: string;
  host?: AgentHostBinding;
}
/** Small public facade over the existing Task snapshot, resolver and execution Kernel. */
export async function connectLoom(options: AgentConnectionOptions) {
  const store = await LocalTaskStore.open(options.taskRoot);
  if (store.task.id !== options.taskId) throw new ContainerFailure('InvalidRecord', 'Task identity does not match.');
  const application = store.task.application;
  const binding = options.host ? { ...options.host, actor: structuredClone(options.host.actor) } : undefined;
  const hostDelivery = binding?.delivery ?? (binding ? 'declared' : 'missing');
  const requestCopy = (value: AgentRequest) => {
    validateRequest(value);
    const request = structuredClone(value);
    invocationRequirements(profileFor(application, request.entry_id), store.task.id, request);
    return request;
  };
  return {
    discover: (filter?: DiscoveryFilter) => discoverEntries(application, filter),
    describe: (entryId: string) => describeEntry(application, entryId),
    async check(value: AgentRequest, checkOptions: { native_preflight?: boolean } = {}) {
      const request = requestCopy(value);
      const profile = profileFor(application, request.entry_id);
      const blockers: { stage?: string; diagnostic: SafeDiagnostic; input_name?: string; candidates?: string[] }[] = [];
      const inputs: { name: string | null; status: 'satisfied' | 'blocked'; artifact_id?: string; candidates: string[] }[] = [];
      const artifacts = await store.listArtifacts();
      for (const requirement of invocationRequirements(profile, store.task.id, request)) {
        const candidates = artifacts.filter(a => a.type === requirement.type && a.version === requirement.version
          && a.verification.status === requirement.verification_status
          && (requirement.artifact_id === undefined || a.id === requirement.artifact_id)).map(a => a.id);
        try {
          const ref = await store.resolveArtifact(requirement);
          inputs.push({ name: requirement.input_name ?? null, status: 'satisfied', artifact_id: ref.id, candidates });
        } catch (error) {
          if (!(error instanceof ContainerFailure) || !['PreconditionNotSatisfied', 'BindingConflict'].includes(error.code)) throw error;
          blockers.push({ diagnostic: diagnosticFor(error, 'artifact-input', false),
            ...(requirement.input_name ? { input_name: requirement.input_name } : {}), candidates });
          inputs.push({ name: requirement.input_name ?? null, status: 'blocked', candidates });
        }
      }
      type CheckStatus = 'not-checked' | 'passed' | 'failed';
      let hostBindings: CheckStatus = 'not-checked';
      let native: CheckStatus = 'not-checked';
      let bindingsReason: string | null = 'prior-blocker';
      let nativeReason: string | null = checkOptions.native_preflight ? 'prior-blocker' : 'not-requested';
      let nativeAttempted = false;
      if (hostDelivery !== 'declared') blockers.push({ stage: 'host-delivery', diagnostic: diagnosticFor(new ContainerFailure('NativeIntegrationNotReady', 'Host missing.'), 'host', false) });
      if (blockers.length === 0 && binding) {
        const plan = await prepareSession(store, profile.id, undefined, request);
        bindingsReason = binding.checkBindings ? null : 'unsupported';
        if (binding.checkBindings) {
          try { await binding.checkBindings(structuredClone(plan)); hostBindings = 'passed'; }
          catch (error) { hostBindings = 'failed'; blockers.push({ stage: 'host-bindings', diagnostic: diagnosticFor(error, 'host', false) }); }
        }
        if (checkOptions.native_preflight && blockers.length === 0) {
          if (!binding.nativePreflight) {
            nativeReason = 'unsupported';
            blockers.push({ stage: 'native-preflight', diagnostic: diagnosticFor(new ContainerFailure('NativeIntegrationNotReady', 'Native preflight is unavailable.'), 'host', false) });
          } else {
            nativeReason = null; nativeAttempted = true;
            try { await binding.nativePreflight(structuredClone(plan)); native = 'passed'; }
            catch (error) { native = 'failed'; blockers.push({ stage: 'native-preflight', diagnostic: diagnosticFor(error, 'host', false) }); }
          }
        }
      }
      return { schema_version: 1, request_id: request.request_id, task_id: store.task.id, entry_id: request.entry_id,
        declaration: 'valid', inputs, blockers, host: { delivery: hostDelivery, bindings: hostBindings, bindings_unchecked_reason: bindingsReason },
        native_preflight: { status: native, unchecked_reason: nativeReason, coverage: native === 'passed' ? 'host-defined-resources' : 'none', effect_scope: nativeAttempted ? 'trusted-native-code-may-load' : 'none' },
        unchecked: ['artifact-bytes', 'model-configuration', 'credentials', 'domain-initialization', 'business-acceptance', 'external-side-effects'],
        observation_only: true };
    },
    async invoke(value: AgentRequest): Promise<AgentReceipt> {
      const request = requestCopy(value);
      let sessionId: string | null = null;
      let started = false;
      let failure: unknown;
      try {
        const profile = profileFor(application, request.entry_id);
        const plan = await prepareSession(store, profile.id, undefined, request);
        if (!binding || hostDelivery !== 'declared') throw new ContainerFailure('NativeIntegrationNotReady', 'Host delivery is missing.');
        const host = await binding.createHost({ store, plan: structuredClone(plan) });
        await executeSession(store, plan, host, binding.actor, observation => {
          sessionId = observation.session_id;
          if (observation.phase === 'domain-started') started = true;
        });
      } catch (error) { failure = error; }
      try {
        const snapshot = await inspectTask(store);
        const session = sessionId ? taskInspectionView(snapshot).sessions.find(s => s.id === sessionId) : undefined;
        if (session) {
          const result = receiptFromSession(session);
          if (failure instanceof ContainerFailure && failure.code === 'StorageFailure' && !result.observation.outcome_confirmed)
            result.call_diagnostic = diagnosticFor(failure, 'governance-storage', started);
          return result;
        }
        if (failure instanceof ContainerFailure && failure.code === 'StorageFailure') throw failure;
      } catch (error) {
        return { schema_version: 1, request_id: request.request_id, task_id: store.task.id, entry_id: request.entry_id,
          session_id: sessionId, execution: { status: 'unknown', domain_execution_started: started }, artifacts: [], aspect_failures: [],
          observation: { history: 'unreadable', recorded_session_status: null, outcome_confirmed: false },
          requested_inputs: requestedInputs(request), resolved_inputs: { status: 'unavailable', bindings: [] }, consumed: [],
          business_acceptance: { status: 'not-evaluated' }, diagnostic: diagnosticFor(error, 'governance-storage', started),
          inspection_ref: { task_id: store.task.id, session_id: sessionId }, retry_safety: 'not-established' };
      }
      return { schema_version: 1, request_id: request.request_id, task_id: store.task.id, entry_id: request.entry_id,
        session_id: sessionId, execution: { status: sessionId ? 'unknown' : 'not-started', domain_execution_started: false }, artifacts: [], aspect_failures: [],
        observation: { history: 'readable', recorded_session_status: null, outcome_confirmed: sessionId === null },
        requested_inputs: requestedInputs(request), resolved_inputs: { status: 'unavailable', bindings: [] }, consumed: [],
        business_acceptance: { status: 'not-evaluated' }, diagnostic: diagnosticFor(failure, 'native', false),
        inspection_ref: { task_id: store.task.id, session_id: sessionId }, retry_safety: 'not-established' };
    },
    async inspect(filter: { entry_id?: string; session_id?: string; request_id?: string; artifact_id?: string } = {}) {
      if (filter.entry_id) profileFor(application, filter.entry_id);
      try {
        const snapshot = await inspectTask(store);
        const view = taskInspectionView(snapshot);
        const sessions = view.sessions.filter(s => (!filter.entry_id || (s.request?.entry_id ?? application.profiles.find(p => p.id === s.profile_id)?.entry?.id ?? s.profile_id) === filter.entry_id)
          && (!filter.session_id || s.id === filter.session_id) && (!filter.request_id || s.request?.request_id === filter.request_id)
          && (!filter.artifact_id || s.produced.some(a => a.id === filter.artifact_id) || s.consumed.some(a => a.artifact_id === filter.artifact_id)
            || s.resolved_inputs?.bindings.some(a => a.artifact_id === filter.artifact_id)));
        const sessionIds = new Set(sessions.map(s => s.id));
        const relatedArtifacts = new Set(sessions.flatMap(s => [...s.produced.map(a => a.id),
          ...s.consumed.map(c => c.artifact_id), ...(s.resolved_inputs?.bindings.map(b => b.artifact_id) ?? [])]));
        return { schema_version: 1, task_id: store.task.id, history: 'readable',
          readiness: { host_delivery: hostDelivery, native_compatibility: 'not-checked', credentials: 'unknown', external_side_effects: 'unknown' },
          sessions: sessions.map(s => s.request ? receiptFromSession(s) : { session_id: s.id, profile_id: s.profile_id,
            execution: { status: s.status }, request_id: null, identity_migration: 'not-inferred',
            resolved_inputs: { status: s.resolved_inputs ? 'recorded' : 'unavailable', bindings: structuredClone(s.resolved_inputs?.bindings ?? []) },
            consumed: consumedInputs(s) }),
          artifacts: snapshot.artifacts.filter(a => (!filter.artifact_id || a.id === filter.artifact_id)
            && ((!filter.session_id && !filter.entry_id && !filter.request_id) || relatedArtifacts.has(a.id)))
            .map(a => ({ id: a.id, type: a.type, version: a.version, producer: a.producer, sha256: a.sha256, verification: a.verification,
              consumers: a.consumers.filter(c => (!filter.session_id && !filter.entry_id && !filter.request_id) || sessionIds.has(c.session_id))
                .map(c => ({ id: c.id, artifact_id: c.artifact_id, accepted_sha256: c.sha256, consumer_session_id: c.session_id,
                  consumer_plugin_id: c.consumer_plugin_id, consumed_at: c.consumed_at })) })) };
      } catch (error) {
        return { schema_version: 1, task_id: store.task.id, history: 'unreadable',
          diagnostic: diagnosticFor(error, 'governance-storage'), sessions: [], artifacts: [] };
      }
    },
  };
}

/** IDs correlate attempts; repeating a request intentionally creates a new Session. */
export function createRequest(taskId: string, entryId: string): AgentRequest {
  const request: AgentRequest = { schema_version: 1, request_id: randomUUID(), task_id: taskId, entry_id: entryId };
  validateRequest(request);
  return request;
}
