export type FailureCode =
  | 'InvalidDefinition'
  | 'InvalidRecord'
  | 'InvalidTransition'
  | 'PreconditionNotSatisfied'
  | 'BindingConflict'
  | 'TaskNotFound'
  | 'LegacyStoreDetected'
  | 'NativeIntegrationNotReady'
  | 'NativeExecutionFailed'
  | 'InvalidArguments'
  | 'StorageFailure';

export class ContainerFailure extends Error {
  readonly code: FailureCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: FailureCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = 'ContainerFailure';
    this.code = code;
    this.details = details;
  }
}

export interface FailureRecord {
  code: string;
  message: string;
  source: string;
  timestamp: string;
}

/** Structured observer failure context. Unspecified preserves older callers. */
export interface ObserverFailureContext {
  phase: string;
  failure_class: 'native-hook' | 'aspect-execution' | 'publication-validation' | 'governance-storage' | 'unspecified';
}

export type InvocationResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: { code: FailureCode; message: string } };
