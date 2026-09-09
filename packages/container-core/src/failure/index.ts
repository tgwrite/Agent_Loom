export type FailureCode =
  | 'InvalidDefinition'
  | 'InvalidRecord'
  | 'InvalidTransition'
  | 'PreconditionNotSatisfied'
  | 'BindingConflict'
  | 'StorageFailure';

export class ContainerFailure extends Error {
  readonly code: FailureCode;

  constructor(code: FailureCode, message: string) {
    super(message);
    this.name = 'ContainerFailure';
    this.code = code;
  }
}

export type InvocationResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: { code: FailureCode; message: string } };
