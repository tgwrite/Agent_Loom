/** Proposed by the baseline; real compatibility verification is still pending. */
import { ContainerFailure } from '../../container-core/src/index.ts';

export const PI_REFERENCE_TARGET = '0.85.1';

/** Fail closed until actual Bridge and native initializer contracts are verified. */
export function requireNativeIntegration(): never {
  throw new ContainerFailure('NativeIntegrationNotReady', 'Native Pi integration has not been implemented or verified.', {
    pending: ['pi-bridge', 'native-plugin-bindings', 'publication-observation', 'domain-initialization'],
  });
}

/** Native entrypoints are injected locally and must not be committed. */
export interface PiBridgeConfiguration {
  task_root: string;
  profile_id: string;
  native_bindings: Readonly<Record<string, string>>;
}
