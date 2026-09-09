import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import type { TestContext } from 'node:test';

const executable = resolve('bin/loom.mjs');
const application = resolve('tests/fixtures/synthetic.app.ts');
const processFixture = resolve('tests/fixtures/session-process.mjs');

async function scratch(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-loom-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const taskRoot = join(directory, 'task');
  const unrelated = join(directory, 'unrelated');
  await mkdir(unrelated);
  const env = { ...process.env, LOOM_STATE_DIR: join(directory, '.agent-loom') };
  return { directory, taskRoot, unrelated, env };
}

function run(args: string[], env: NodeJS.ProcessEnv, cwd = process.cwd()) {
  const result = spawnSync(process.execPath, [executable, ...args], { env, cwd, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('CLI distinguishes definition validation from native integration readiness', async (t) => {
  const { env } = await scratch(t);
  const definition = run(['app', 'validate', application, '--definition-only', '--json'], env);
  assert.equal(definition.status, 0);
  assert.equal(JSON.parse(definition.stdout).definition, 'valid');
  const full = run(['app', 'validate', application, '--json'], env);
  assert.equal(full.status, 1);
  assert.equal(JSON.parse(full.stderr).error.code, 'NativeIntegrationNotReady');
  assert.equal(run(['task', 'create', '--unknown'], env).status, 1);
});

test('Tasks retain their definition and can be inspected from an unrelated working directory', async (t) => {
  const { directory, taskRoot, unrelated, env } = await scratch(t);
  const localApp = join(directory, 'temporary.app.mjs');
  await writeFile(localApp, `export { default } from ${JSON.stringify(pathToFileURL(application).href)};\n`);
  const created = run(['task', 'create', '--app', localApp, '--root', taskRoot, '--name', 'task-one', '--json'], env);
  assert.equal(created.status, 0);
  await rm(localApp);
  const inspected = run(['task', 'inspect', 'task-one', '--json'], env, unrelated);
  assert.equal(inspected.status, 0);
  assert.equal(JSON.parse(inspected.stdout).task.application.version, '1');
  const planned = run(['session', 'start', '--task', 'task-one', '--profile', 'test-profile', '--dry-run', '--json'], env, unrelated);
  assert.equal(planned.status, 0);
  assert.equal(JSON.parse(planned.stdout).executed, false);
  assert.equal(JSON.parse(inspected.stdout).sessions.length, 0);
  const duplicate = run(['task', 'create', '--app', application, '--root', join(directory, 'another'), '--name', 'task-one'], env);
  assert.equal(JSON.parse(duplicate.stderr).error.code, 'BindingConflict');
});

test('an explicit Task root bypasses a missing local index but still checks Task identity', async (t) => {
  const { directory, taskRoot, unrelated, env } = await scratch(t);
  assert.equal(run(['task', 'create', '--app', application, '--root', taskRoot, '--name', 'task-one'], env).status, 0);
  const fresh = { ...env, LOOM_STATE_DIR: join(directory, 'fresh-index') };
  const missing = run(['task', 'inspect', 'task-one', '--json'], fresh, unrelated);
  assert.equal(JSON.parse(missing.stderr).error.code, 'TaskNotFound');
  assert.equal(run(['task', 'inspect', 'task-one', '--root', taskRoot, '--json'], fresh, unrelated).status, 0);
  const wrong = run(['task', 'inspect', 'other-task', '--root', taskRoot, '--json'], fresh, unrelated);
  assert.equal(JSON.parse(wrong.stderr).error.code, 'InvalidRecord');
});

test('missing dependencies and unready native execution leave no fabricated Sessions', async (t) => {
  const { taskRoot, env } = await scratch(t);
  assert.equal(run(['task', 'create', '--app', application, '--root', taskRoot, '--name', 'task-one'], env).status, 0);
  const missing = run(['session', 'start', '--task', 'task-one', '--profile', 'test-consumer', '--json'], env);
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stderr).error.code, 'PreconditionNotSatisfied');
  assert.equal(JSON.parse(missing.stderr).error.details.missing[0].type, 'SyntheticHandoff');
  const unavailable = run(['session', 'start', '--task', 'task-one', '--profile', 'test-profile', '--json'], env);
  assert.equal(JSON.parse(unavailable.stderr).error.code, 'NativeIntegrationNotReady');
  const inspected = run(['task', 'inspect', 'task-one', '--json'], env);
  assert.equal(JSON.parse(inspected.stdout).sessions.length, 0);
});

test('CLI loads an explicit local Host after preconditions and persists its native binding', async t => {
  const { directory, taskRoot, env } = await scratch(t);
  assert.equal(run(['task', 'create', '--app', application, '--root', taskRoot, '--name', 'task-one'], env).status, 0);
  const hostFile = join(directory, 'synthetic-host.mjs');
  await writeFile(hostFile, `export function createSessionHost() {
    return { runtime: { id: 'synthetic', name: 'synthetic', version: '1' },
      async validate() {}, async launch() {
        return { runtime_session_id: 'synthetic-cli-session', async initialize() {},
          async run() { return { status: 'completed' }; }, async close() {} };
      } };
  }`);
  const base = ['session', 'start', '--task', 'task-one', '--profile', 'test-profile'];
  const invalid = run([...base, '--host-module', hostFile, '--dry-run'], env);
  assert.equal(JSON.parse(invalid.stderr).error.code, 'InvalidArguments');
  const missing = run([...base, '--host-module', join(directory, 'missing.mjs')], env);
  assert.equal(JSON.parse(missing.stderr).error.code, 'NativeIntegrationNotReady');
  const precondition = run(['session', 'start', '--task', 'task-one', '--profile', 'test-consumer',
    '--host-module', join(directory, 'missing.mjs')], env);
  assert.equal(JSON.parse(precondition.stderr).error.code, 'PreconditionNotSatisfied');
  const executed = run([...base, '--host-module', hostFile, '--json'], env);
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(JSON.parse(executed.stdout).session.runtime_session_id, 'synthetic-cli-session');
  const snapshot = JSON.parse(run(['task', 'inspect', 'task-one', '--json'], env).stdout);
  assert.equal(snapshot.sessions.length, 1);
  assert.equal(snapshot.sessions[0].status, 'completed');
});

test('separate producer and consumer processes leave inspectable lineage in a shared Task', async (t) => {
  const { taskRoot, unrelated, env } = await scratch(t);
  assert.equal(run(['task', 'create', '--app', application, '--root', taskRoot, '--name', 'task-one'], env).status, 0);
  for (const operation of ['produce', 'consume']) {
    const child = spawnSync(process.execPath, [processFixture, operation, taskRoot],
      { env, cwd: unrelated, encoding: 'utf8', timeout: 15000 });
    assert.equal(child.status, 0, child.stderr);
  }
  const inspected = run(['task', 'inspect', 'task-one', '--json'], env, unrelated);
  assert.equal(inspected.status, 0);
  const snapshot = JSON.parse(inspected.stdout);
  assert.equal(snapshot.sessions.length, 2);
  const consumer = snapshot.sessions.find((item: { profile_id: string }) => item.profile_id === 'test-consumer');
  assert.equal(consumer.status, 'completed');
  assert.equal(consumer.workspace, 'consumer');
  assert.equal(consumer.consumed[0].producer.session_id, 'producer');
  assert.equal(consumer.runtime_session_id, 'synthetic-native-session');
  const artifact = run(['artifact', 'inspect', 'artifact-one', '--task', 'task-one', '--json'], env, unrelated);
  assert.equal(JSON.parse(artifact.stdout).consumers[0].session_id, consumer.id);
  assert.equal(JSON.parse(artifact.stdout).payload_location, join(taskRoot, 'fixtures', 'synthetic-handoff.json'));
  const session = run(['session', 'inspect', consumer.id, '--task', 'task-one', '--json'], env, unrelated);
  assert.equal(JSON.parse(session.stdout).consumed.length, 1);
  assert.match(run(['task', 'inspect', 'task-one'], env, unrelated).stdout, /Consumed: artifact-one <- producer/);
});
