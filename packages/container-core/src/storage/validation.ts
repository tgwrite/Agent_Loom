import type { ArtifactRecord, ArtifactConsumptionRecord } from '../artifact/index.ts';
import { validateApplication } from '../application/index.ts';
import { taskRelativePath } from '../paths.ts';
import type { FailureRecord } from '../failure/index.ts';
import type { EventEnvelope } from '../event/index.ts';
import { ContainerFailure } from '../failure/index.ts';
import type { SessionRunRecord } from '../session/index.ts';
import type { TaskRecord } from '../task/index.ts';

export function requireRecord(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ContainerFailure('InvalidRecord', message);
}

export function identifier(value: string): void {
  requireRecord(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value), 'Invalid record identifier.');
}

function text(value: string): void {
  requireRecord(typeof value === 'string' && value.trim().length > 0, 'A required field is empty.');
}

function timestamp(value: string): void {
  requireRecord(typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value, 'Timestamp must be an ISO UTC string.');
}

function jsonValue(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  requireRecord(typeof value === 'object' && value !== null && !seen.has(value), 'Invalid JSON payload.');
  requireRecord(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype,
    'Payload must contain only plain JSON values.');
  seen.add(value);
  for (const item of Object.values(value)) jsonValue(item, seen);
  seen.delete(value);
}

export function validateTask(value: TaskRecord): void {
  requireRecord(value.schema_version === 2, 'Unsupported Task schema version.');
  identifier(value.id);
  identifier(value.application_id);
  validateApplication(value.application);
  requireRecord(value.application.id === value.application_id, 'Task Application identity does not match its snapshot.');
  text(value.title);
  timestamp(value.created_at);
}

export function validateSession(value: SessionRunRecord): void {
  identifier(value.id);
  identifier(value.task_id);
  identifier(value.profile_id);
  identifier(value.actor.id);
  identifier(value.runtime.id);
  text(value.runtime.name);
  text(value.runtime.version);
  if (value.runtime_session_id !== undefined) text(value.runtime_session_id);
  requireRecord(Array.isArray(value.plugin_ids), 'Session Plugins must be an array.');
  value.plugin_ids.forEach(identifier);
  taskRelativePath(value.workspace, true);
  requireRecord(!/^\.agent-(?:loom|container)(?:\/|$)/i.test(value.workspace), 'Workspace cannot use the governance directory.');
  requireRecord(Array.isArray(value.aspect_plugin_ids), 'Session aspects must be an array.');
  value.aspect_plugin_ids.forEach(identifier);
  if (value.primary_plugin_id !== undefined) identifier(value.primary_plugin_id);
  const composed = [...(value.primary_plugin_id ? [value.primary_plugin_id] : []), ...value.aspect_plugin_ids];
  requireRecord(JSON.stringify(composed) === JSON.stringify(value.plugin_ids), 'Session Plugin roles do not match its composition.');
  requireRecord(new Set(value.plugin_ids).size === value.plugin_ids.length, 'Duplicate Session Plugin.');
  requireRecord(['running', 'completed', 'failed'].includes(value.status), 'Invalid Session status.');
  timestamp(value.started_at);
  if (value.failure !== undefined) {
    validateFailure(value.failure);
    requireRecord(value.status === 'failed', 'Only a failed Session may contain a Session failure.');
  }
  if (value.status === 'running') {
    requireRecord(value.finished_at === undefined, 'Running Session cannot have a finish timestamp.');
  } else {
    requireRecord(value.finished_at !== undefined, 'Settled Session needs a finish timestamp.');
    timestamp(value.finished_at);
    requireRecord(value.finished_at >= value.started_at, 'Session cannot finish before it starts.');
  }
}

export function validateArtifact(value: ArtifactRecord): void {
  [value.id, value.task_id, value.producer.plugin_id, value.producer.capability_id,
    value.producer.session_id, value.executor.actor_id, value.executor.runtime_id].forEach(identifier);
  text(value.type);
  text(value.version);
  text(value.verification.status);
  if (value.producer_phase !== undefined || value.native_runtime_session_id !== undefined) {
    requireRecord(value.producer_phase === 'domain-run' || value.producer_phase === 'aspect-after-run',
      'Native publication phase is invalid.');
    requireRecord(typeof value.native_runtime_session_id === 'string' && value.native_runtime_session_id.trim().length > 0,
      'Native publication requires a native Session identity.');
  }
  timestamp(value.created_at);
  requireRecord(typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256),
    'Artifact needs a lowercase SHA-256 digest.');
  if (value.payload_ref.kind === 'file') {
    taskRelativePath(value.payload_ref.path);
  } else {
    requireRecord(value.payload_ref.kind === 'inline', 'Unsupported Artifact payload reference.');
    jsonValue(value.payload_ref.value);
  }
}

export function validateEvent(value: EventEnvelope): void {
  [value.id, value.task_id, value.session_id, value.actor_id, value.correlation_id].forEach(identifier);
  text(value.source);
  timestamp(value.timestamp);
  requireRecord(typeof value.type === 'string' && (
    /^(session|capability)\.(started|completed|failed)$/.test(value.type)
    || value.type === 'artifact.published' || value.type === 'artifact.consumed'
    || value.type === 'observer.failed' || /^runtime\.[a-z][a-z0-9_.-]*$/.test(value.type)
  ), 'Unsupported Event type.');
  jsonValue(value.payload);
  if (value.type === 'observer.failed') {
    const payload = value.payload as unknown as { plugin_id: string; failure: FailureRecord; contract_version?: number;
      phase?: string; failure_class?: string };
    requireRecord(payload !== null && typeof payload === 'object', 'Observer failure payload is required.');
    identifier(payload.plugin_id);
    requireRecord(payload.failure !== null && typeof payload.failure === 'object', 'Observer failure details are required.');
    validateFailure(payload.failure);
    // Existing V1 rows remain readable without inventing historical phase facts.
    if (payload.contract_version !== undefined || payload.phase !== undefined || payload.failure_class !== undefined) {
      requireRecord(payload.contract_version === 2, 'Unsupported observer failure contract.');
      requireRecord(typeof payload.phase === 'string' && /^[a-z][a-z0-9_-]*$/.test(payload.phase), 'Observer phase is invalid.');
      requireRecord(['native-hook', 'aspect-execution', 'publication-validation', 'governance-storage', 'unspecified']
        .includes(payload.failure_class ?? ''), 'Observer failure class is invalid.');
    }
  }
}

export function validateConsumption(value: ArtifactConsumptionRecord): void {
  [value.id, value.task_id, value.session_id, value.consumer_plugin_id, value.artifact_id].forEach(identifier);
  requireRecord(typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256), 'Consumption needs the accepted Artifact digest.');
  timestamp(value.consumed_at);
}

export function validateFailure(value: FailureRecord): void {
  text(value.code);
  text(value.message);
  text(value.source);
  timestamp(value.timestamp);
}
