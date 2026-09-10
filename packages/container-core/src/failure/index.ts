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

export type { ObserverFailureContext } from './observer.ts';

export type InvocationResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: { code: FailureCode; message: string } };
