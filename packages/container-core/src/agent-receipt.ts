import { isDeepStrictEqual } from 'node:util';
import { ContainerFailure } from './failure/index.ts';
import { readSafeDiagnostic } from './failure/diagnostic.ts';
import type { SafeDiagnostic } from './failure/diagnostic.ts';
import type { TaskInspection } from './inspection.ts';
import type { ResolvedInput, SessionRunRecord, SessionProfile } from './session/index.ts';
import type { AgentRequest } from './invocation.ts';
import { readParticipantObservation } from './participant-observation.ts';

export interface AgentReceipt {
  schema_version: 1;
  request_id: string;
  task_id: string;
  entry_id: string;
  session_id: string | null;
  execution: { status: 'not-started' | 'running' | 'completed' | 'failed' | 'unknown'; domain_execution_started: boolean | 'unknown' };
  observation: { history: 'not-checked' | 'readable' | 'unreadable'; recorded_session_status: SessionRunRecord['status'] | null; outcome_confirmed: boolean };
  requested_inputs: { input_name: string; artifact_id: string }[];
  resolved_inputs: { status: 'recorded' | 'unavailable'; bindings: ResolvedInput[] };
  consumed: { id: string; artifact_id: string; accepted_sha256: string; producer_session_id: string;
    consumer_session_id: string; consumer_plugin_id: string; consumed_at: string; input_names: string[] | null }[];
  artifacts: { id: string; type: string; version: string; producer_plugin_id: string }[];
  aspect_failures: { plugin_id: string; reason_code: string }[];
  participants: ParticipantSummary;
  business_acceptance: { status: 'not-evaluated'; references?: { artifact_id: string; producer_plugin_id: string; type: string; version: string }[] };
  diagnostic?: SafeDiagnostic;
  /** Immediate observation only; not a replacement for persisted outcome evidence. */
  call_diagnostic?: SafeDiagnostic;
  inspection_ref: { task_id: string; session_id: string | null };
  retry_safety: 'not-established';
}

export function requestedInputs(request: AgentRequest): AgentReceipt['requested_inputs'] {
  return Object.entries(request.inputs ?? {}).map(([input_name, ref]) => ({ input_name, artifact_id: ref.artifact_id }));
}

/** Invocation identity is added only when it was actually recorded. */
export function receiptFromSession(session: TaskInspection['sessions'][number]): AgentReceipt {
  if (!session.request) throw new ContainerFailure('InvalidRecord', 'Session has no invocation request.');
  return { schema_version: 1, request_id: session.request.request_id, task_id: session.task_id,
    entry_id: session.request.entry_id, session_id: session.id,
    requested_inputs: requestedInputs(session.request), ...projectSessionFacts(session) };
}

export interface ParticipantSummary {
  primary: { plugin_id: string; status: 'completed' | 'failed' | 'started' | 'not-observed' } | null;
  aspects: { plugin_id: string; status: 'completed' | 'failed' | 'unconfirmed' | 'publication-observed' | 'not-observed';
    evidence_scope: 'after-run' | 'recorded-failure' | 'publication-only' | 'none'; artifact_ids: string[] }[];
}

export function unobservedParticipants(profile: SessionProfile): ParticipantSummary {
  return { primary: profile.primary ? { plugin_id: profile.primary, status: 'not-observed' } : null,
    aspects: profile.aspects.map(plugin_id => ({ plugin_id, status: 'not-observed', evidence_scope: 'none', artifact_ids: [] })) };
}

function participants(session: TaskInspection['sessions'][number]): ParticipantSummary {
  const observations = session.events.map(readParticipantObservation).filter(observation => observation !== undefined);
  const domain = observations.filter(observation => observation.plugin_id === session.primary_plugin_id && observation.phase === 'domain-run');
  const primary: ParticipantSummary['primary'] = session.primary_plugin_id ? { plugin_id: session.primary_plugin_id,
    status: domain.some(observation => observation.status === 'failed') ? 'failed'
      : domain.filter(observation => observation.status === 'completed').length === 1 ? 'completed'
      : session.events.some(event => event.type === 'runtime.loom.domain-started') ? 'started' : 'not-observed' } : null;
  return { primary, aspects: session.aspect_plugin_ids.map(plugin_id => {
    const events = observations.filter(observation => observation.plugin_id === plugin_id && observation.phase === 'aspect-after-run');
    const started = events.filter(observation => observation.status === 'started');
    const completed = events.filter(observation => observation.status === 'completed');
    const failed = session.aspect_failures.some(failure => failure.plugin_id === plugin_id) || events.some(observation => observation.status === 'failed');
    const artifact_ids = session.produced.filter(artifact => artifact.producer.plugin_id === plugin_id).map(artifact => artifact.id);
    const confirmed = started.length === 1 && completed.length === 1 && events.indexOf(started[0]!) < events.indexOf(completed[0]!);
    return { plugin_id, artifact_ids, status: failed ? 'failed' : confirmed ? 'completed'
      : started.length || completed.length ? 'unconfirmed' : artifact_ids.length ? 'publication-observed' : 'not-observed',
      evidence_scope: failed ? 'recorded-failure' : started.length || completed.length ? 'after-run' : artifact_ids.length ? 'publication-only' : 'none' };
  }) };
}

type SessionFacts = Pick<AgentReceipt, 'execution' | 'observation' | 'resolved_inputs' | 'consumed'
  | 'artifacts' | 'aspect_failures' | 'participants' | 'business_acceptance' | 'diagnostic' | 'inspection_ref' | 'retry_safety'>;

/** Both supported entrypoints interpret governance evidence without inventing request identity. */
export function projectSessionFacts(session: TaskInspection['sessions'][number]): SessionFacts {
  const storedDiagnostic = readSafeDiagnostic(session.failure?.diagnostic);
  const terminalEvents = session.events.filter(e => e.type === 'session.completed' || e.type === 'session.failed');
  const terminal = terminalEvents[0];
  const terminalFailure = terminal?.payload && typeof terminal.payload === 'object' && !Array.isArray(terminal.payload)
    ? terminal.payload.failure : undefined;
  const confirmed = session.status !== 'running' && terminalEvents.length === 1
    && terminal?.type === `session.${session.status}` && terminal.timestamp === session.finished_at
    && isDeepStrictEqual(terminalFailure, session.failure);
  const started = session.events.some(e => e.type === 'runtime.loom.domain-started')
    ? true : storedDiagnostic?.domain_execution_started ?? 'unknown';
  const diagnostic: SafeDiagnostic | undefined = confirmed ? storedDiagnostic : {
    diagnostic_version: 1, boundary: 'governance-storage', reason_code: 'OUTCOME_UNCONFIRMED', retry_safety: 'not-established',
    ...(typeof started === 'boolean' ? { domain_execution_started: started } : {}) };
  return { execution: { status: confirmed ? session.status : 'unknown', domain_execution_started: started },
    observation: { history: 'readable', recorded_session_status: session.status, outcome_confirmed: confirmed },
    resolved_inputs: { status: session.resolved_inputs ? 'recorded' : 'unavailable', bindings: structuredClone(session.resolved_inputs?.bindings ?? []) },
    consumed: consumedInputs(session),
    artifacts: session.produced.map(a => ({ id: a.id, type: a.type, version: a.version, producer_plugin_id: a.producer.plugin_id })),
    aspect_failures: session.aspect_failures.map(a => ({ plugin_id: a.plugin_id, reason_code: readSafeDiagnostic(a.failure.diagnostic)?.reason_code ?? 'ASPECT_FAILED' })),
    participants: participants(session),
    business_acceptance: { status: 'not-evaluated', references: session.produced.filter(artifact =>
      session.acceptance_artifact_contracts.some(contract => contract.producer_plugin_id === artifact.producer.plugin_id
        && contract.type === artifact.type && contract.version === artifact.version))
      .map(artifact => ({ artifact_id: artifact.id, producer_plugin_id: artifact.producer.plugin_id, type: artifact.type, version: artifact.version })) },
    ...(diagnostic ? { diagnostic } : {}),
    inspection_ref: { task_id: session.task_id, session_id: session.id }, retry_safety: 'not-established' };
}

export function consumedInputs(session: TaskInspection['sessions'][number]): AgentReceipt['consumed'] {
  const names = new Map<string, string[]>();
  for (const binding of session.resolved_inputs?.bindings ?? []) {
    const key = `${binding.artifact_id}:${binding.sha256}`;
    const list = names.get(key) ?? [];
    if (binding.input_name) list.push(binding.input_name);
    names.set(key, list);
  }
  return session.consumed.map(c => ({ id: c.id, artifact_id: c.artifact_id, accepted_sha256: c.sha256,
      producer_session_id: c.producer.session_id, consumer_session_id: c.session_id, consumer_plugin_id: c.consumer_plugin_id,
      consumed_at: c.consumed_at, input_names: session.resolved_inputs && c.consumer_plugin_id === session.primary_plugin_id
        ? [...(names.get(`${c.artifact_id}:${c.sha256}`) ?? [])] : null }));
}
