/** Proposed by the baseline; real compatibility verification is still pending. */
import { ContainerFailure } from '../../container-core/src/index.ts';

export { createPiSessionHost } from './session-host.ts';
export type { PiSdk, PiSession, PiPluginBinding, PiSessionContext, PiSessionHostOptions } from './session-host.ts';

export const PI_REFERENCE_TARGET = '0.85.1';

/** Built-in execution stays closed until native publication and initialization are wired. */
export function requireNativeIntegration(): never {
  throw new ContainerFailure('NativeIntegrationNotReady', 'Built-in native Plugin integration is not configured.', {
    pending: ['native-plugin-bindings', 'publication-observation', 'domain-initialization'],
  });
}

/** Native entrypoints are injected locally and must not be committed. */
export interface PiBridgeConfiguration {
  task_root: string;
  profile_id: string;
  native_bindings: Readonly<Record<string, string>>;
}
