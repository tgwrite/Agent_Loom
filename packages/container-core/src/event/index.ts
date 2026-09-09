import type { JsonValue } from '../json.ts';

export type CoreEventType =
  | 'session.started'
  | 'session.completed'
  | 'session.failed'
  | 'capability.started'
  | 'capability.completed'
  | 'capability.failed'
  | 'artifact.published'
  | 'artifact.consumed'
  | 'observer.failed';

export interface EventEnvelope {
  id: string;
  type: CoreEventType | `runtime.${string}`;
  timestamp: string;
  task_id: string;
  session_id: string;
  actor_id: string;
  source: string;
  correlation_id: string;
  payload: JsonValue;
}
