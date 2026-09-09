import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeRuntime } from '../lightweight/native-runtime.mjs';
import { installScriptedDecisions } from '../lightweight/scripted.mjs';
import { launcher } from './launcher.mjs';
import { provider } from './provider.mjs';
import { retroAdapter } from './retro-adapter.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
await mkdir(join(repo, '.test-tmp/composite'), { recursive: true });
const root = await mkdtemp(join(repo, '.test-tmp/composite/probe-'));
const workspace = join(root, 'workspace');
await mkdir(workspace);
const model = await provider();
let session;
try {
  const adapter = retroAdapter({ review_provider: model.baseUrl, launcher_env: await launcher(root) });
  const runtime = await nativeRuntime(root, { mode: 'scripted' });
  const { sdk, agentDir, settings, modelRuntime } = runtime;
  const settingsManager = sdk.SettingsManager.inMemory(settings);
  const resourceLoader = new sdk.DefaultResourceLoader({ cwd: workspace, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true,
    additionalExtensionPaths: [adapter.entry] });
  await resourceLoader.reload();
  assert.equal(resourceLoader.getExtensions().errors.length, 0);
  ({ session } = await sdk.createAgentSession({ cwd: workspace, agentDir, modelRuntime, settingsManager, resourceLoader,
    sessionManager: sdk.SessionManager.create(workspace, join(root, 'native-sessions')) }));
  await session.bindExtensions({ mode: 'rpc', onError(error) { throw error; } });
  await installScriptedDecisions(session, 'no-tools');
  await session.prompt('Synthetic isolated review input. MAIN_PROBE_CANARY.');
  const before = JSON.stringify(session.messages);
  const publications = await adapter.afterRun(session, { task_root: root, workspace, session_id: 'probe-session' });
  assert.equal(publications.length, 2);
  assert.equal(JSON.stringify(session.messages), before);
  assert.equal(model.requests.length, 3);
  assert(JSON.stringify(model.requests[1]).includes('MAIN_PROBE_CANARY'));
  await writeFile(join(root, 'result.local.json'), JSON.stringify({ status: 'passed', publications, requests: model.requests }, null, 2));
  console.log(JSON.stringify({ status: 'passed', native_review_requests: model.requests.length, output: relative(repo, root) }));
} catch (error) {
  await writeFile(join(root, 'failure.local.txt'), String(error?.stack ?? error));
  await writeFile(join(root, 'requests.local.json'), JSON.stringify(model.requests, null, 2));
  console.error(`Native review probe failed; inspect ${relative(repo, root)}`);
  process.exitCode = 1;
} finally { session?.dispose(); await model.close(); }
