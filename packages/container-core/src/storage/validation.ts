import { posix, win32 } from 'node:path';
import type { ArtifactRecord } from '../artifact/index.ts';
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
  requireRecord(value.schema_version === 1, 'Unsupported Task schema version.');
  identifier(value.id);
  identifier(value.application_id);
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
  requireRecord(new Set(value.plugin_ids).size === value.plugin_ids.length, 'Duplicate Session Plugin.');
  requireRecord(['running', 'completed', 'failed'].includes(value.status), 'Invalid Session status.');
  timestamp(value.started_at);
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
  timestamp(value.created_at);
  requireRecord(typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256),
    'Artifact needs a lowercase SHA-256 digest.');
  if (value.payload_ref.kind === 'file') {
    const path = value.payload_ref.path;
    text(path);
    requireRecord(!posix.isAbsolute(path) && !win32.isAbsolute(path)
      && !path.includes('\\') && !path.includes(':') && !/[\x00-\x1f]/.test(path)
      && path.split('/').every((part) => part !== '..' && part !== '.' && part !== ''),
    'Artifact file reference must be relative to the Task root.');
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
    || value.type === 'artifact.published' || /^runtime\.[a-z][a-z0-9_.-]*$/.test(value.type)
  ), 'Unsupported Event type.');
  jsonValue(value.payload);
}
