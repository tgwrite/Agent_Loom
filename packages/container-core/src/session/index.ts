import type { ActorRef, RuntimeRef } from '../actor/index.ts';
import type { ArtifactRequirement } from '../artifact/index.ts';
import type { FailureRecord } from '../failure/index.ts';
import type { AgentRequest, EntryContract } from '../invocation.ts';

export interface SessionProfile {
  entry?: EntryContract;
  id: string;
  primary?: string;
  aspects: readonly string[];
  requirements: readonly ArtifactRequirement[];
  workspace?: string;
}

export interface SessionRunRecord {
  resolved_inputs?: { binding_version: 1; bindings: ResolvedInput[] };
  request?: AgentRequest;
  id: string;
  task_id: string;
  profile_id: string;
  plugin_ids: readonly string[];
  workspace: string;
  primary_plugin_id?: string;
  aspect_plugin_ids: readonly string[];
  actor: ActorRef;
  runtime: RuntimeRef;
  runtime_session_id?: string;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  finished_at?: string;
  failure?: FailureRecord;
}

/** Selection evidence captured before initialization; never proof of consumption. */
export interface ResolvedInput {
  requirement_index: number;
  input_name?: string;
  artifact_id: string;
  sha256: string;
}
