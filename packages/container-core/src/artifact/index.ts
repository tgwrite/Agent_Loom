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

export type ArtifactProducerPhase = 'domain-run' | 'aspect-after-run';

/** Both fields are present for V2 native publications, absent for legacy records. */
export interface ArtifactNativeProvenance {
  producer_phase?: ArtifactProducerPhase;
  native_runtime_session_id?: string;
}

export interface ArtifactRecord extends ArtifactContract, ArtifactNativeProvenance {
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

export interface ArtifactRef extends ArtifactContract, ArtifactNativeProvenance {
  id: string;
  task_id: string;
  payload_ref: PayloadRef;
  sha256: string;
  producer: ArtifactRecord['producer'];
  executor: ArtifactRecord['executor'];
  verification: ArtifactRecord['verification'];
}

/** A consumer-reported successful initialization, not a registry lookup. */
export interface ArtifactConsumptionRecord {
  id: string;
  task_id: string;
  session_id: string;
  consumer_plugin_id: string;
  artifact_id: string;
  sha256: string;
  consumed_at: string;
}
