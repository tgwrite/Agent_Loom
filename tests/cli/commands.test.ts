import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import type { TestContext } from 'node:test';

const executable = resolve('bin/loom.mjs');
const application = resolve('tests/fixtures/synthetic.app.ts');
const processFixture = resolve('tests/fixtures/session-process.mjs');

test('CLI reports the missing entry field and accepts the corrected definition without loading its Host', async t => {
  const f = await scratch(t);
  const app = join(f.directory, 'entry.app.mjs');
  const { testApplication } = await import('../helpers.ts');
  const entry: Record<string, unknown> = { id: 'sample.run', purpose: 'Synthetic entry', request_mapping: 'v1' };
  const save = () => writeFile(app, `export const nativeHost = './host.mjs'; export const application = ${JSON.stringify({
    ...testApplication, profiles: [{ ...testApplication.profiles[0], entry }],
  })};`);
  await writeFile(join(f.directory, 'host.mjs'), 'throw new Error("synthetic-host-canary");');
  const args = ['app', 'validate', app, '--definition-only', '--explain', '--json'];
  for (const field of ['implementation', 'effect_declarations']) {
    await save();
    const result = run(args, f.env);
    assert.equal(result.status, 1);
    const failure = JSON.parse(result.stderr);
    assert.equal(failure.error.code, 'InvalidDefinition');
    assert.equal(failure.error.details.path, `profiles[0].entry.${field}`);
    assert.equal(failure.diagnostic.phase, 'application-loading');
    assert(!result.stderr.includes('synthetic-host-canary'));
    entry[field] = field === 'implementation' ? 'native' : [];
  }
  await save();
  const result = run(args, f.env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).definition, 'valid');
  assert.equal(JSON.parse(result.stdout).native_integration, 'not-verified');
});

test('CLI snapshots validated opaque input and rejects bad input before creating a Task', async t => {
  const f = await scratch(t);
  const app = join(f.directory, 'input.app.mjs'), input = join(f.directory, 'input.json');
  await writeFile(app, `export { default } from ${JSON.stringify(pathToFileURL(application).href)};
    export function validateTaskInput(value) {
      if (!Number.isInteger(value?.threshold)) throw new Error('private input diagnostic');
      value.threshold = 999;
    }`);
  const args = ['task', 'create', '--app', app, '--root', f.taskRoot, '--name', 'input-task', '--input', input, '--json'];
  await writeFile(input, '{broken');
  let result = run(args, f.env);
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).diagnostic.phase, 'task-input');
  await assert.rejects(stat(f.taskRoot), { code: 'ENOENT' });
  await writeFile(input, '{"threshold":"wrong"}');
  result = run(args, f.env);
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).error.details.check, 'validateTaskInput');
  assert(!result.stderr.includes('private input diagnostic'));
  await assert.rejects(stat(f.taskRoot), { code: 'ENOENT' });
  await writeFile(input, '{"threshold":7}');
  result = run(args, f.env); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).input.validation, 'application-validated');
  await writeFile(input, '{"threshold":8}');
  const saved = join(f.taskRoot, '.agent-loom', 'input.json');
  assert.deepEqual(JSON.parse(await readFile(saved, 'utf8')), { threshold: 7 });
  assert.equal(run(args, f.env).status, 1);
  assert.deepEqual(JSON.parse(await readFile(saved, 'utf8')), { threshold: 7 });
  const { readTaskInput } = await import('../../packages/runtime-pi/src/index.ts');
  assert.equal(await readTaskInput({ taskRoot: f.taskRoot }, value => (value as { threshold: number }).threshold), 7);
});

test('explanation does not load a Host, and summary preserves the full JSON contract', async t => {
  const f = await scratch(t);
  const app = join(f.directory, 'explain.app.mjs');
  await writeFile(app, `export { default } from ${JSON.stringify(pathToFileURL(application).href)};
    export const nativeHost = './must-not-load.mjs';`);
  await writeFile(join(f.directory, 'must-not-load.mjs'), 'throw new Error("Host was loaded");');
  const explained = run(['app', 'validate', app, '--definition-only', '--explain', '--json'], f.env);
  assert.equal(explained.status, 0, explained.stderr);
  const value = JSON.parse(explained.stdout);
  assert.equal(value.native_integration, 'not-verified');
  assert.equal(value.explanation.execution, 'explicit-session-start');
  assert.equal(value.explanation.profiles.find((p: { id: string }) => p.id === 'test-consumer').requirements[0].type, 'SyntheticHandoff');
  assert.equal(run(['task', 'create', '--app', app, '--root', f.taskRoot, '--name', 'summary-task'], f.env).status, 0);
  const args = ['task', 'inspect', 'summary-task', '--json'];
  const before = run(args, f.env).stdout;
  const summary = run([...args, '--summary'], f.env);
  assert.equal(summary.status, 0);
  assert.equal(JSON.parse(summary.stdout).business_acceptance, 'not-evaluated');
  assert.equal(JSON.parse(summary.stdout).schema_version, 1);
  assert.equal(run(args, f.env).stdout, before);
  const blocked = run(['session', 'start', '--task', 'summary-task', '--profile', 'test-consumer', '--json'], f.env);
  assert.equal(JSON.parse(blocked.stderr).error.code, 'PreconditionNotSatisfied');
  assert.equal(JSON.parse(blocked.stderr).diagnostic.phase, 'dependency-resolution');
  assert.equal(run(args, f.env).stdout, before);
  assert.equal(run(['task', 'inspect', '--help'], f.env).status, 0);
});

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

test('Application native preflight requires an explicit validator and reports its limited scope', async t => {
  const { directory, env } = await scratch(t);
  const hostFile = join(directory, 'preflight.mjs');
  await writeFile(hostFile, `export async function validateNativeApplication({ application }) {
    if (application.id !== 'test-app') throw new Error('unexpected application');
  }`);
  const base = ['app', 'validate', application, '--host-module', hostFile, '--json'];
  const valid = run(base, env);
  assert.equal(valid.status, 0);
  assert.equal(JSON.parse(valid.stdout).native_integration, 'host-preflight-passed');
  assert.equal(JSON.parse(run([...base, '--definition-only'], env).stderr).error.code, 'InvalidArguments');
  await writeFile(hostFile, 'export function createSessionHost() {}');
  const unavailable = run(base, env);
  assert.equal(unavailable.status, 1);
  assert.equal(JSON.parse(unavailable.stderr).error.code, 'NativeIntegrationNotReady');
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

test('Application host binding is captured once and reused after its definition is removed', async t => {
  const { directory, taskRoot, unrelated, env } = await scratch(t);
  const host = join(directory, 'bound-host.mjs');
  await writeFile(host, `export async function validateNativeApplication() {}
    export function createSessionHost() { return {
      runtime: { id: 'synthetic', name: 'synthetic', version: '1' }, async validate() {},
      async launch() { return { runtime_session_id: 'bound-native-session', async initialize() {},
        async run() { return { status: 'completed' }; }, async close() {} }; }
    }; }`);
  const app = join(directory, 'bound.app.mjs');
  await writeFile(app, `export { default } from ${JSON.stringify(pathToFileURL(application).href)};
    export const nativeHost = './bound-host.mjs';`);
  assert.equal(run(['app', 'validate', app, '--json'], env).status, 0);
  assert.equal(run(['app', 'validate', app, '--definition-only', '--json'], env).status, 0);
  assert.equal(run(['task', 'create', '--app', app, '--root', taskRoot, '--name', 'bound'], env).status, 0);
  await rm(app);
  const started = run(['session', 'start', '--task', 'bound', '--profile', 'test-profile', '--json'], env, unrelated);
  assert.equal(started.status, 0, started.stderr);
  assert.equal(JSON.parse(started.stdout).session.runtime_session_id, 'bound-native-session');
  const fresh = { ...env, LOOM_STATE_DIR: join(directory, 'empty-index') };
  const again = run(['session', 'start', '--task', 'bound', '--root', taskRoot,
    '--profile', 'test-profile', '--json'], fresh, unrelated);
  assert.equal(again.status, 0, again.stderr);
  await writeFile(join(taskRoot, '.agent-loom', 'native-host.json'), '{broken');
  const corrupt = run(['session', 'start', '--task', 'bound', '--profile', 'test-profile'], env);
  assert.equal(JSON.parse(corrupt.stderr).error.code, 'NativeIntegrationNotReady');
});
