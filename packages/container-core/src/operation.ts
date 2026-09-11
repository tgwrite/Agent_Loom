import { isDeepStrictEqual } from 'node:util';
import type { TaskInspection } from './inspection.ts';
import { receiptFromSession } from './agent-receipt.ts';

/** Correlation is scoped to this Task and request ID, independent of display filters. */
export function operationSummary(sessions: TaskInspection['sessions'], requestId: string) {
  const attempts = sessions.filter(session => session.request?.request_id === requestId);
  const first = attempts[0]?.request;
  const consistent = attempts.every(session => isDeepStrictEqual(session.request, first));
  const outcomes = attempts.map(session => {
    const receipt = receiptFromSession(session);
    return { session_id: session.id, entry_id: session.request!.entry_id, started_at: session.started_at,
      execution: receipt.execution, observation: receipt.observation };
  }).sort((a, b) => a.started_at.localeCompare(b.started_at) || a.session_id.localeCompare(b.session_id));
  return { request_id: requestId, scope: 'task-request-id', attempt_count: attempts.length,
    request_consistency: !first ? 'no-attempts' : consistent ? 'same' : 'conflicting',
    status: !first ? 'not-recorded' : !consistent ? 'conflicting-requests'
      : outcomes.some(outcome => !outcome.observation.outcome_confirmed) ? 'unconfirmed' : 'all-confirmed',
    attempts: outcomes, retry_safety: 'not-established', idempotency: 'not-provided' };
}
