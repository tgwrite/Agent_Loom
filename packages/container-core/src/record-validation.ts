import { ContainerFailure } from './failure/index.ts';
import type { FailureRecord } from './failure/index.ts';

export function requireRecord(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ContainerFailure('InvalidRecord', message);
}

export function identifier(value: string): void {
  requireRecord(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value), 'Invalid record identifier.');
}

export function text(value: string): void {
  requireRecord(typeof value === 'string' && value.trim().length > 0, 'A required field is empty.');
}

export function timestamp(value: string): void {
  requireRecord(typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value, 'Timestamp must be an ISO UTC string.');
}

export function jsonValue(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  requireRecord(typeof value === 'object' && value !== null && !seen.has(value), 'Invalid JSON payload.');
  requireRecord(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype,
    'Payload must contain only plain JSON values.');
  seen.add(value);
  for (const item of Object.values(value)) jsonValue(item, seen);
  seen.delete(value);
}

export function validateFailure(value: FailureRecord): void {
  text(value.code);
  text(value.message);
  text(value.source);
  timestamp(value.timestamp);
}
