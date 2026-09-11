export type ReadinessStatus = 'passed' | 'failed' | 'not-checked';
export interface NativeReadinessReport {
  sdk: ReadinessStatus;
  bindings: ReadinessStatus;
  resources: ReadinessStatus;
  launcher: ReadinessStatus;
}

/** Legacy void preflight results carry no claim about individual checks. */
export function nativeReadinessReport(value: unknown): NativeReadinessReport {
  const report = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const status = (key: string): ReadinessStatus => report[key] === 'passed' || report[key] === 'failed' ? report[key] : 'not-checked';
  return { sdk: status('sdk'), bindings: status('bindings'), resources: status('resources'), launcher: status('launcher') };
}
