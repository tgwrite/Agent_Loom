import type { ActorRef, RuntimeRef } from '../actor/index.ts';
import type { ArtifactRequirement } from '../artifact/index.ts';

export interface SessionProfile {
  id: string;
  primary?: string;
  aspects: readonly string[];
  requirements: readonly ArtifactRequirement[];
}

export interface SessionRunRecord {
  id: string;
  task_id: string;
  profile_id: string;
  plugin_ids: readonly string[];
  actor: ActorRef;
  runtime: RuntimeRef;
  runtime_session_id?: string;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  finished_at?: string;
}
