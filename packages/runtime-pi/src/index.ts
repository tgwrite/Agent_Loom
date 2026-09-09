/** Proposed by the baseline; real compatibility verification is still pending. */
export const PI_REFERENCE_TARGET = '0.85.1';

/** Native entrypoints are injected locally and must not be committed. */
export interface PiBridgeConfiguration {
  task_root: string;
  profile_id: string;
  native_bindings: Readonly<Record<string, string>>;
}
