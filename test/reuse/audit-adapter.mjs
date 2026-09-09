import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Translate the native command and its file into publication facts. The Host
// supplies all governance identity, hashing, indexing and failure persistence.
export function auditAdapter(config = {}) {
  return { entry: fileURLToPath(new URL('./native/session-audit.mjs', import.meta.url)),
    async afterRun(session, context, outcome) {
      const command = session.extensionRunner.getCommand('session-audit');
      assert(command, 'Native audit command missing');
      const requestId = randomUUID();
      await command.handler(JSON.stringify({ request_id: requestId, outcome, fail: !!config.audit_fault }),
        session.extensionRunner.createCommandContext());
      const path = join(context.workspace, '.pi-session-audit', `${requestId}.json`);
      const summary = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(summary.schema, 'pi-session-audit-v1');
      assert.equal(summary.request_id, requestId);
      assert.equal(summary.native_session_id, session.sessionManager.getSessionId());
      assert.equal(summary.reported_outcome, outcome);
      return [{ type: 'audit.session-summary', version: '1', verification_status: 'COMPLETED',
        path: relative(context.task_root, path).replaceAll('\\', '/') }];
    },
  };
}
