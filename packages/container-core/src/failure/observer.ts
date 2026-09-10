import type { FailureRecord } from './index.ts';
import { identifier, requireRecord, validateFailure } from '../record-validation.ts';

const failureClasses = ['native-hook', 'aspect-execution', 'publication-validation', 'governance-storage', 'unspecified'] as const;

/** Structured observer facts. Unspecified preserves older callers. */
export interface ObserverFailureContext {
  phase: string;
  failure_class: typeof failureClasses[number];
}

type ObserverFailurePayload = { plugin_id: string; failure: FailureRecord } & (
  | { contract_version?: never; phase?: never; failure_class?: never }
  | ({ contract_version: 2 } & ObserverFailureContext)
);

export function createObserverFailure(pluginId: string, failure: FailureRecord, context: ObserverFailureContext) {
  return { contract_version: 2 as const, plugin_id: pluginId, phase: context.phase, failure_class: context.failure_class,
    failure: { ...failure } };
}

export function validateObserverFailure(value: unknown): asserts value is ObserverFailurePayload {
  const payload = value as ObserverFailurePayload;
  requireRecord(payload !== null && typeof payload === 'object', 'Observer failure payload is required.');
  identifier(payload.plugin_id);
  requireRecord(payload.failure !== null && typeof payload.failure === 'object', 'Observer failure details are required.');
  validateFailure(payload.failure);
  // Existing V1 rows remain readable without inventing historical phase facts.
  if (payload.contract_version !== undefined || payload.phase !== undefined || payload.failure_class !== undefined) {
    requireRecord(payload.contract_version === 2, 'Unsupported observer failure contract.');
    requireRecord(typeof payload.phase === 'string' && /^[a-z][a-z0-9_-]*$/.test(payload.phase), 'Observer phase is invalid.');
    requireRecord(failureClasses.includes(payload.failure_class), 'Observer failure class is invalid.');
  }
}

/** A normalized read view; null context means the historical record has no phase facts. */
export function readObserverFailure(payload: unknown) {
  validateObserverFailure(payload);
  return { plugin_id: payload.plugin_id, failure: structuredClone(payload.failure),
    context: payload.contract_version === 2 ? { phase: payload.phase, failure_class: payload.failure_class } : null };
}
