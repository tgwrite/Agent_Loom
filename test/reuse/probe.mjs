import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeRuntime } from '../lightweight/native-runtime.mjs';
import { installScriptedDecisions } from '../lightweight/scripted.mjs';
import { auditAdapter } from './audit-adapter.mjs';
import { freeze } from './freeze.mjs';

freeze();
const repo = fileURLToPath(new URL('../../', import.meta.url));
await mkdir(join(repo, '.test-tmp/reuse'), { recursive: true });
const root = await mkdtemp(join(repo, '.test-tmp/reuse/probe-'));
const { sdk, agentDir, settings, modelRuntime } = await nativeRuntime(root, { mode: 'scripted' });
const adapter = auditAdapter();
const settingsManager = sdk.SettingsManager.inMemory(settings);
const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir, settingsManager, noExtensions: true,
  noSkills: true, noThemes: true, noPromptTemplates: true, additionalExtensionPaths: [adapter.entry] });
await loader.reload();
assert.equal(loader.getExtensions().errors.length, 0);
const { session } = await sdk.createAgentSession({ cwd: root, agentDir, modelRuntime, settingsManager, resourceLoader: loader,
  sessionManager: sdk.SessionManager.create(root, join(root, 'native-sessions')) });
try {
  await session.bindExtensions({ mode: 'rpc', onError(error) { throw error; } });
  await installScriptedDecisions(session, 'no-tools');
  await session.prompt('Synthetic independent native session audit probe.');
  const before = JSON.stringify(session.messages);
  const facts = await adapter.afterRun(session, { task_root: root, workspace: root }, 'failed');
  assert.equal(facts.length, 1);
  const native = JSON.parse(await readFile(join(root, facts[0].path), 'utf8'));
  assert.equal(native.reported_outcome, 'failed');
  assert.equal(native.counts.user, 1);
  assert.equal(native.counts.assistant, 1);
  assert.equal(native.native_session_id, session.sessionManager.getSessionId());
  assert.equal(JSON.stringify(session.messages), before);
  await assert.rejects(auditAdapter({ audit_fault: true }).afterRun(session, { task_root: root, workspace: root }, 'completed'));
  await writeFile(join(root, 'result.local.json'), JSON.stringify({ status: 'passed', native, without_loom: true, freeze: freeze() }, null, 2));
  console.log(JSON.stringify({ status: 'passed', output: relative(repo, root) }));
} finally { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' }); session.dispose(); }
