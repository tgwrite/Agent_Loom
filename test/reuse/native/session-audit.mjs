import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Independent native Pi extension. It knows only Pi's current branch and its
// explicit command input, never Loom identities, stores, events or contracts.
export default function sessionAudit(pi) {
  let started = false;
  pi.on('session_start', () => { started = true; });
  pi.registerCommand('session-audit', {
    description: 'Write a structural audit of the current native Pi session',
    async handler(raw, ctx) {
      assert(started, 'Native session lifecycle must start before audit');
      const { request_id, outcome, fail = false } = JSON.parse(raw);
      assert(/^[a-f0-9-]{36}$/.test(request_id));
      assert(['completed', 'failed'].includes(outcome));
      const messages = ctx.sessionManager.getBranch().filter(entry => entry.type === 'message').map(entry => entry.message);
      if (fail) throw new Error('Injected native session audit failure');
      const summary = {
        schema: 'pi-session-audit-v1', native_session_id: ctx.sessionManager.getSessionId(),
        request_id, reported_outcome: outcome, created_at: new Date().toISOString(),
        counts: { user: messages.filter(m => m.role === 'user').length,
          assistant: messages.filter(m => m.role === 'assistant').length,
          tool_results: messages.filter(m => m.role === 'toolResult').length,
          tool_errors: messages.filter(m => m.role === 'toolResult' && m.isError).length },
        note: 'Structural audit only; the supplied outcome is not an independent semantic verdict.',
      };
      const output = join(ctx.cwd, '.pi-session-audit');
      await mkdir(output, { recursive: true });
      await writeFile(join(output, `${request_id}.json`), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
    },
  });
}
