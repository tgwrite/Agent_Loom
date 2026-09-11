export { validateArtifactShape as validateArtifact } from '../artifact/index.ts';
import { identifier, requireRecord, text, timestamp, jsonValue, validateFailure } from '../record-validation.ts';
export { identifier, requireRecord, validateFailure } from '../record-validation.ts';
import { validateObserverFailure } from '../failure/observer.ts';
import type { ArtifactConsumptionRecord } from '../artifact/index.ts';
import { validateApplication } from '../application/index.ts';
import { validateRequest } from '../invocation.ts';
import { taskRelativePath } from '../paths.ts';
import type { EventEnvelope } from '../event/index.ts';
import type { SessionRunRecord } from '../session/index.ts';
import type { TaskRecord } from '../task/index.ts';

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
  if (value.resolved_inputs !== undefined) {
    const snapshot = value.resolved_inputs;
    requireRecord(snapshot !== null && snapshot.binding_version === 1 && Array.isArray(snapshot.bindings), 'Unsupported input binding snapshot.');
    requireRecord(Object.keys(snapshot).every(key => ['binding_version', 'bindings'].includes(key)), 'Unknown input snapshot field.');
    snapshot.bindings.forEach((binding, index) => {
      requireRecord(binding !== null && binding.requirement_index === index, 'Invalid input requirement index.');
      requireRecord(Object.keys(binding).every(key => ['requirement_index', 'input_name', 'artifact_id', 'sha256'].includes(key)), 'Unknown input binding field.');
      identifier(binding.artifact_id);
      if (binding.input_name !== undefined) identifier(binding.input_name);
      requireRecord(typeof binding.sha256 === 'string' && /^[a-f0-9]{64}$/.test(binding.sha256), 'Invalid input digest.');
    });
  }
  if (value.request !== undefined) { validateRequest(value.request); requireRecord(value.request.task_id === value.task_id, 'Request Task identity mismatch.'); }
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
  if (value.type === 'observer.failed') validateObserverFailure(value.payload);
}

export function validateConsumption(value: ArtifactConsumptionRecord): void {
  [value.id, value.task_id, value.session_id, value.consumer_plugin_id, value.artifact_id].forEach(identifier);
  requireRecord(typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256), 'Consumption needs the accepted Artifact digest.');
  timestamp(value.consumed_at);
}
