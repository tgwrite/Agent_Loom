import type { JsonValue } from '../json.ts';

export interface ArtifactContract {
  type: string;
  version: string;
}

export interface ArtifactRequirement extends ArtifactContract {
  verification_status: string;
  artifact_id?: string;
}

export type PayloadRef =
  | { kind: 'file'; path: string }
  | { kind: 'inline'; value: JsonValue };

export interface ArtifactRecord extends ArtifactContract {
  id: string;
  task_id: string;
  producer: {
    plugin_id: string;
    capability_id: string;
    session_id: string;
  };
  executor: { actor_id: string; runtime_id: string };
  verification: { status: string };
  payload_ref: PayloadRef;
  sha256: string;
  created_at: string;
}

export interface ArtifactRef extends ArtifactContract {
  id: string;
  task_id: string;
  payload_ref: PayloadRef;
  sha256: string;
}
