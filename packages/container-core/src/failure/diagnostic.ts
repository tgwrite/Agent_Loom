import { ContainerFailure } from './index.ts';
import type { FailureRecord } from './index.ts';

export type DiagnosticBoundary = 'artifact-input' | 'domain' | 'native' | 'aspect' | 'governance-storage' | 'host' | 'request';
export type SafeDiagnostic = {
  diagnostic_version: 1;
  boundary: DiagnosticBoundary;
  reason_code: string;
  input_name?: string;
  artifact_id?: string;
  check?: HostReadinessCheck;
  next_step?: string;
  domain_execution_started?: boolean;
  retry_safety: 'not-established';
}
const boundaries = new Set(['artifact-input', 'domain', 'native', 'aspect', 'governance-storage', 'host', 'request']);
const trusted = new WeakMap<object, SafeDiagnostic>();
const hostSteps = {
  'host-import': 'Check that the local Host module and its dependencies can be imported.',
  'host-contract': 'Export the required Host functions with the documented signatures.',
  'sdk-version': 'Match the selected SDK version to the Application runtime version.',
  'sdk-surface': 'Provide the SDK functions required by the Pi Host adapter.',
  'adapter-registration': 'Register an adapter for every selected Plugin binding key.',
  'plugin-entry': 'Check selected Plugin entry files and duplicate resolved entries.',
  'prompt-directory': 'Check the explicitly configured prompt directories.',
  'extension-loading': 'Check native extension exports and their local dependencies.',
  'launcher': 'Run the application launcher probe and check its local configuration.',
} as const;
export type HostReadinessCheck = keyof typeof hostSteps;

/** Only reviewed stage names and static recovery hints cross the native boundary. */
export function hostReadinessFailure(check: HostReadinessCheck): ContainerFailure {
  if (!Object.hasOwn(hostSteps, check)) throw new ContainerFailure('InvalidArguments', 'Unknown Host readiness check.');
  const diagnostic: SafeDiagnostic = { diagnostic_version: 1, boundary: 'host', reason_code: 'HOST_UNAVAILABLE',
    check, next_step: hostSteps[check], retry_safety: 'not-established' };
  const failure = new ContainerFailure('NativeIntegrationNotReady', 'Native Host readiness check failed.', { diagnostic });
  trusted.set(failure, diagnostic);
  return failure;
}

export function safeHostReadinessFailure(error: unknown, fallback: HostReadinessCheck): ContainerFailure {
  const diagnostic = typeof error === 'object' && error !== null ? trusted.get(error) : undefined;
  return hostReadinessFailure(diagnostic?.check ?? fallback);
}

/** Safe returned failure. Trust is process-local and does not survive serialization or cloning. */
export function createNativeFailure(error: unknown, started?: boolean): FailureRecord {
  const diagnostic = diagnosticFor(error, 'native', started);
  const failure: FailureRecord = { code: 'NativeExecutionFailed', message: 'Native initialization or execution failed.',
    source: 'native-adapter', timestamp: new Date().toISOString(), diagnostic };
  trusted.set(failure, structuredClone(diagnostic));
  return failure;
}

/** Reconstruct only the documented fields; never forward Plugin message/stack/details. */
export function readSafeDiagnostic(value: unknown): SafeDiagnostic | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const d = value as Record<string, unknown>;
  if (d.diagnostic_version !== 1 || !boundaries.has(d.boundary as string)
    || typeof d.reason_code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(d.reason_code)
    || d.retry_safety !== 'not-established') return undefined;
  const result: SafeDiagnostic = { diagnostic_version: 1, boundary: d.boundary as DiagnosticBoundary,
    reason_code: d.reason_code, retry_safety: 'not-established' };
  if (d.check !== undefined) {
    if (typeof d.check !== 'string' || !Object.hasOwn(hostSteps, d.check)) return undefined;
    result.check = d.check as HostReadinessCheck;
    result.next_step = hostSteps[result.check];
  }
  for (const field of ['input_name', 'artifact_id'] as const) {
    if (d[field] !== undefined) {
      if (typeof d[field] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(d[field])) return undefined;
      result[field] = d[field];
    }
  }
  if (d.domain_execution_started !== undefined) {
    if (typeof d.domain_execution_started !== 'boolean') return undefined;
    result.domain_execution_started = d.domain_execution_started;
  }
  return result;
}

/** Call at a trusted adapter registration boundary with reviewed, static reason codes. */
export function registerSafeDiagnostics(boundary: DiagnosticBoundary, reasonCodes: readonly string[]) {
  const codes = new Set(reasonCodes);
  if (!boundaries.has(boundary) || [...codes].some(code => !/^[A-Z][A-Z0-9_]{0,63}$/.test(code)))
    throw new ContainerFailure('InvalidDefinition', 'Invalid diagnostic registration.');
  return (reason: string, refs: { input_name?: string; artifact_id?: string } = {}): ContainerFailure => {
    if (!codes.has(reason)) throw new ContainerFailure('InvalidRecord', 'Unregistered diagnostic reason.');
    const diagnostic = readSafeDiagnostic({ ...refs, diagnostic_version: 1, boundary, reason_code: reason, retry_safety: 'not-established' });
    if (!diagnostic) throw new ContainerFailure('InvalidRecord', 'Invalid diagnostic reference.');
    const failure = new ContainerFailure(boundary === 'artifact-input' ? 'InvalidRecord' : 'NativeExecutionFailed', 'Managed operation was rejected.', { diagnostic });
    trusted.set(failure, structuredClone(diagnostic));
    return failure;
  };
}

export function safeNativeFailure(error: unknown): ContainerFailure {
  const diagnostic = typeof error === 'object' && error !== null ? trusted.get(error) : undefined;
  if (diagnostic) {
    const failure = new ContainerFailure('NativeExecutionFailed', 'Managed operation was rejected.', { diagnostic: { ...diagnostic } });
    trusted.set(failure, structuredClone(diagnostic));
    return failure;
  }
  if (error instanceof ContainerFailure && error.code === 'NativeIntegrationNotReady') {
    const failure = new ContainerFailure('NativeExecutionFailed', 'Selected Host binding is unavailable.');
    trusted.set(failure, { diagnostic_version: 1, boundary: 'host', reason_code: 'HOST_UNAVAILABLE', retry_safety: 'not-established' });
    return failure;
  }
  if (error instanceof ContainerFailure && error.code === 'StorageFailure')
    return new ContainerFailure('StorageFailure', 'Unable to persist or read governance facts.');
  return new ContainerFailure('NativeExecutionFailed', 'Native initialization or execution failed.');
}

export function diagnosticFor(error: unknown, boundary: DiagnosticBoundary, started?: boolean): SafeDiagnostic {
  const registered = typeof error === 'object' && error !== null ? trusted.get(error) : undefined;
  const code = error instanceof ContainerFailure ? error.code : undefined;
  const reason = code === 'StorageFailure' ? 'GOVERNANCE_STORAGE_FAILED'
    : code === 'TaskWriterBusy' ? 'TASK_WRITER_BUSY'
    : code === 'TaskOutcomeUnconfirmed' ? 'TASK_OUTCOME_UNCONFIRMED'
    : code === 'TaskWriterReleaseFailed' ? 'TASK_WRITER_RELEASE_FAILED'
    : boundary === 'governance-storage' && code === 'InvalidRecord' ? 'GOVERNANCE_RECORD_INVALID'
    : code === 'PreconditionNotSatisfied' ? 'MISSING_DEPENDENCY'
    : code === 'BindingConflict' ? 'AMBIGUOUS_BINDING'
    : code === 'NativeIntegrationNotReady' ? 'HOST_UNAVAILABLE'
    : code === 'InvalidArguments' || code === 'InvalidRecord' || code === 'InvalidDefinition' ? 'REQUEST_REJECTED'
    : boundary === 'aspect' ? 'ASPECT_FAILED' : 'NATIVE_EXECUTION_FAILED';
  return { ...(registered ?? { diagnostic_version: 1, boundary: code === 'StorageFailure' ? 'governance-storage' : boundary,
    reason_code: reason, retry_safety: 'not-established' }), ...(started === undefined ? {} : { domain_execution_started: started }) };
}
