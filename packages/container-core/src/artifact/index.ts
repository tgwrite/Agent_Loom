import { identifier, requireRecord, text, timestamp, jsonValue } from '../record-validation.ts';
import { taskRelativePath } from '../paths.ts';
import type { JsonValue } from '../json.ts';

export interface ArtifactContract {
  type: string;
  version: string;
}

export interface ArtifactRequirement extends ArtifactContract {
  input_name?: string;
  verification_status: string;
  artifact_id?: string;
}

export type PayloadRef =
  | { kind: 'file'; path: string }
  | { kind: 'inline'; value: JsonValue };

/** One definition of native fields drives validation, types and reference projection. */
export function readNativeProvenance(value: object) {
  const { producer_phase, native_runtime_session_id } = value as Record<string, unknown>;
  if (producer_phase === undefined && native_runtime_session_id === undefined) return null;
  requireRecord(producer_phase === 'domain-run' || producer_phase === 'aspect-after-run',
    'Native publication phase is invalid.');
  requireRecord(typeof native_runtime_session_id === 'string' && native_runtime_session_id.trim().length > 0,
    'Native publication requires a native Session identity.');
  return { producer_phase, native_runtime_session_id } as const;
}

/** Both fields are present for V2 native publications, absent for legacy records. */
type NativeProvenance = NonNullable<ReturnType<typeof readNativeProvenance>>;
export type ArtifactNativeProvenance = { -readonly [Key in keyof NativeProvenance]?: NativeProvenance[Key] };
export type ArtifactProducerPhase = NativeProvenance['producer_phase'];

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

export function validateArtifactShape(value: ArtifactRecord): void {
  [value.id, value.task_id, value.producer.plugin_id, value.producer.capability_id,
    value.producer.session_id, value.executor.actor_id, value.executor.runtime_id].forEach(identifier);
  text(value.type);
  text(value.version);
  text(value.verification.status);
  readNativeProvenance(value);
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

export type ArtifactRef = Omit<ArtifactRecord, 'created_at'>;

/** A detached reference to accepted facts; persisted extensions are not exposed. */
export function toArtifactRef(artifact: ArtifactRecord): ArtifactRef {
  return structuredClone({ id: artifact.id, task_id: artifact.task_id, type: artifact.type,
    version: artifact.version, payload_ref: artifact.payload_ref, sha256: artifact.sha256,
    producer: artifact.producer, executor: artifact.executor, verification: artifact.verification,
    ...readNativeProvenance(artifact) });
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
