import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setup as priorSetup } from '../composite/setup.mjs';
import { auditAdapter } from './audit-adapter.mjs';

export async function setup(root, config) {
  const runtime = await priorSetup(root, config);
  const audit = auditAdapter(config);
  const run = audit.afterRun;
  // Fault injection and isolation observations are shared by both arms. Native
  // audit content and governance records are never manufactured here.
  audit.afterRun = async (session, context, outcome) => {
    const before = JSON.stringify(session.messages);
    const tools = session.extensionRunner.getActiveTools();
    const system = session.systemPrompt;
    let facts, failed = false;
    try { facts = await run(session, context, outcome); }
    catch (error) { failed = true; throw error; }
    finally {
      assert.equal(JSON.stringify(session.messages), before);
      assert.deepEqual(session.extensionRunner.getActiveTools(), tools);
      assert.equal(session.systemPrompt, system);
      await writeFile(join(context.workspace, context.session_id, 'audit-observation.local.json'), JSON.stringify({
        outcome, command_failed: failed, unchanged: true, actual_load_order: session.extensionRunner.getExtensionPaths(),
      }, null, 2));
    }
    if (config.invalid_audit === 'escape') facts[0].path = '../outside.json';
    if (config.invalid_audit === 'contract') facts[0].type = 'undeclared.audit';
    if (config.invalid_audit === 'missing') facts[0].path += '.missing';
    return facts;
  };
  runtime.adapters.audit = audit;
  return runtime;
}
