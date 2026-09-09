import type { ArtifactRequirement } from '../artifact/index.ts';
import type { JsonValue } from '../json.ts';

export interface CapabilityDefinition {
  id: string;
  version: string;
  provider: string;
  requirements: readonly ArtifactRequirement[];
}

export interface CapabilityInvocation {
  id: string;
  capability_id: string;
  task_id: string;
  session_id: string;
  actor_id: string;
  input: JsonValue;
}
