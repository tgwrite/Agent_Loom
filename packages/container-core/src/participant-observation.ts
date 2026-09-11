import { randomUUID } from 'node:crypto';
import type { LocalTaskStore } from './storage/index.ts';
import type { EventEnvelope } from './event/index.ts';
import { requireRecord } from './record-validation.ts';

export interface ParticipantObservation {
  plugin_id: string;
  phase: 'domain-run' | 'aspect-after-run';
  status: 'started' | 'completed' | 'failed';
}

/** A Host report about one phase, independent of Runtime and business acceptance. */
export function readParticipantObservation(event: EventEnvelope): ParticipantObservation | undefined {
  if (event.type !== 'runtime.loom.participant' || event.source !== 'session-host') return undefined;
  const value = event.payload;
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.plugin_id !== 'string'
    || !['domain-run', 'aspect-after-run'].includes(value.phase as string)
    || !['started', 'completed', 'failed'].includes(value.status as string)) return undefined;
  return { plugin_id: value.plugin_id, phase: value.phase as ParticipantObservation['phase'], status: value.status as ParticipantObservation['status'] };
}

export async function recordParticipantObservation(store: LocalTaskStore, sessionId: string, observation: ParticipantObservation): Promise<void> {
  const session = await store.getSession(sessionId);
  const event: EventEnvelope = { id: randomUUID(), type: 'runtime.loom.participant', source: 'session-host',
    task_id: session.task_id, session_id: session.id, actor_id: session.actor.id, correlation_id: session.id,
    timestamp: new Date().toISOString(), payload: { plugin_id: observation.plugin_id, phase: observation.phase, status: observation.status } };
  requireRecord(readParticipantObservation(event) !== undefined && (observation.phase === 'domain-run'
    ? observation.plugin_id === session.primary_plugin_id : session.aspect_plugin_ids.includes(observation.plugin_id)),
  'Participant observation does not match Session composition.');
  await store.appendEvent(event);
}
