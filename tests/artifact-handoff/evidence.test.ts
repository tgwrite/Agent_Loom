import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LocalTaskStore } from '../../packages/container-core/src/storage/index.ts';
import { validateApplication } from '../../packages/container-core/src/application/index.ts';
import { connectLoom, createRequest } from '../../packages/container-core/src/agent.ts';
import type { ApplicationDefinition } from '../../packages/container-core/src/application/index.ts';
import type { ArtifactRecord, ArtifactRef } from '../../packages/container-core/src/artifact/index.ts';
import type { SessionHost } from '../../packages/container-core/src/governance.ts';

const stamp = '2026-01-01T00:00:00.000Z';
const result = { type: 'sample.result', version: '1' };
const proof = { type: 'sample.proof', version: '1' };
const requirement = { ...proof, producer_plugin_id: 'verifier', assertion_status: 'READY', input_name: 'proof' };
function application(): ApplicationDefinition {
  return { id: 'evidence', version: '1', runtime: { id: 'synthetic', version: '1' },
    plugins: ['author', 'verifier', 'consumer'].map(id => ({ id, role: 'domain', native: { runtime: 'synthetic', binding_key: id },
      produces: id === 'author' ? [result, proof] : id === 'verifier' ? [proof] : [] })),
    profiles: ['author', 'verifier', 'consumer'].map(id => ({ id, primary: id, aspects: [],
      entry: { id, request_mapping: 'v1' }, requirements: id === 'consumer' ? [
        { ...result, producer_plugin_id: 'author', input_name: 'result' }, requirement] : [] })) };
}
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'loom-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await LocalTaskStore.create(root, { schema_version: 3, id: 'task', application_id: 'evidence',
    application: application(), title: 'Synthetic evidence', created_at: stamp });
  for (const id of ['author', 'verifier']) await store.startSession({ id, task_id: 'task', profile_id: id,
    plugin_ids: [id], primary_plugin_id: id, aspect_plugin_ids: [], workspace: '.', actor: { id: 'actor' },
    runtime: { id: 'synthetic', name: 'synthetic', version: '1' }, status: 'running', started_at: stamp });
  const publish = async (id: string, plugin: string, contract: typeof result, value: Record<string, string>) => {
    const record: ArtifactRecord = { ...contract, id, task_id: 'task', producer: { plugin_id: plugin, session_id: plugin },
      executor: { actor_id: 'actor', runtime_id: 'synthetic' }, assertion: { status: 'READY' },
      payload_ref: { kind: 'inline', value }, sha256: createHash('sha256').update(JSON.stringify(value)).digest('hex'), created_at: stamp };
    return store.publishArtifact(record);
  };
  return { root, store, publish };
}

test('producer requirement is validated against its own declared contract', () => {
  for (const producer_plugin_id of ['missing', 'consumer', '../invalid', '']) {
    const app = application(); app.profiles[2]!.requirements = [{ ...requirement, producer_plugin_id }];
    assert.throws(() => validateApplication(app), { code: 'InvalidDefinition' });
  }
  assert.doesNotThrow(() => validateApplication(application()));
});

test('self-asserted proof cannot satisfy another producer; pins and cold resolution preserve authority', async t => {
  const f = await fixture(t);
  await f.publish('self-proof', 'author', proof, { verdict: 'accepted' });
  await assert.rejects(f.store.resolveArtifact(requirement), { code: 'PreconditionNotSatisfied' });
  await f.publish('proof-one', 'verifier', proof, { verdict: 'accepted' });
  const cold = await LocalTaskStore.open(f.root);
  assert.equal((await cold.resolveArtifact(requirement)).id, 'proof-one');
  await assert.rejects(cold.resolveArtifact({ ...requirement, artifact_id: 'self-proof' }), { code: 'PreconditionNotSatisfied' });
  await f.publish('proof-two', 'verifier', proof, { verdict: 'accepted' });
  await assert.rejects(cold.resolveArtifact(requirement), { code: 'BindingConflict' });
  assert.equal((await cold.resolveArtifact({ ...requirement, artifact_id: 'proof-two' })).id, 'proof-two');
  await assert.rejects(cold.resolveArtifact({ ...requirement, assertion_status: 'OTHER' }), { code: 'PreconditionNotSatisfied' });
  assert.equal((await cold.resolveArtifact({ ...proof, artifact_id: 'self-proof' })).id, 'self-proof');
});

test('exact proof is consumer-verified before consumption and execution; check grants no lasting authority', async t => {
  const f = await fixture(t);
  const subject = await f.publish('result', 'author', result, { answer: 'synthetic' });
  await f.publish('self-proof', 'author', proof, { verdict: 'accepted' });
  let runs = 0, hosts = 0;
  const host: SessionHost = { request_mapping: 'v1', runtime: { id: 'synthetic', name: 'synthetic', version: '1' }, async validate() {},
    async launch() { return { runtime_session_id: 'native', async initialize(inputs: readonly ArtifactRef[]) {
      const [selected, evidence] = inputs;
      assert.equal(evidence!.payload_ref.kind, 'inline');
      const payload = evidence!.payload_ref.kind === 'inline' ? evidence!.payload_ref.value as Record<string, string> : {};
      assert.equal(payload.subject_artifact_id, selected!.id);
      assert.equal(payload.subject_sha256, selected!.sha256);
      assert.equal(payload.verdict, 'accepted');
    }, async run() { runs++; return { status: 'completed' }; }, async close() {} }; } };
  const loom = await connectLoom({ taskRoot: f.root, taskId: 'task', host: { actor: { id: 'actor' }, createHost({ store }) {
    assert.equal(Object.hasOwn(store, 'recordConsumption'), false);
    assert.equal(Object.hasOwn(store, 'settleSession'), false);
    assert.equal(Object.isFrozen(store), true);
    hosts++; return host;
  } } });
  const request = createRequest('task', 'consumer');
  const blocked = await loom.check(request);
  assert.deepEqual(blocked.inputs[1]!.candidates, []);
  assert.equal((await loom.invoke(request)).execution.status, 'not-started'); assert.equal(hosts, 0);
  await f.publish('wrong-proof', 'verifier', proof, { subject_artifact_id: subject.id, subject_sha256: 'wrong', verdict: 'accepted' });
  const rejected = await loom.invoke(request);
  assert.equal(rejected.execution.status, 'failed'); assert.equal(runs, 0);
  assert.equal((await f.store.listConsumptions()).length, 0);
  await f.publish('right-proof', 'verifier', proof, { subject_artifact_id: subject.id, subject_sha256: subject.sha256, verdict: 'accepted' });
  assert.equal((await loom.invoke(request)).execution.status, 'not-started');
  const pinned = { ...request, inputs: { proof: { artifact_id: 'right-proof' } } };
  assert.equal((await loom.check(pinned)).blockers.length, 0);
  const accepted = await loom.invoke(pinned);
  assert.equal(accepted.execution.status, 'completed'); assert.equal(runs, 1);
  assert.deepEqual(accepted.consumed.map(c => c.artifact_id), ['result', 'right-proof']);
  assert.equal(Object.hasOwn(accepted, 'business_acceptance'), false);
  const cold = await connectLoom({ taskRoot: f.root, taskId: 'task' });
  assert.deepEqual((await cold.inspect({ session_id: accepted.session_id! })).sessions[0]!.consumed, accepted.consumed);
  // A forged binding to a same-type self-assertion must fail historical validation too.
  const path = join(f.root, '.agent-loom/sessions', accepted.session_id!, 'session.json');
  const stored = JSON.parse(await readFile(path, 'utf8'));
  delete stored.request.inputs; // No identity pin: this rejection must depend on the producer constraint.
  stored.resolved_inputs.bindings[1].artifact_id = 'self-proof';
  stored.resolved_inputs.bindings[1].sha256 = (await f.store.getArtifact('self-proof')).sha256;
  await writeFile(path, JSON.stringify(stored));
  assert.equal((await cold.inspect()).history, 'unreadable');
});

test('schema 2 is rejected without changing historical bytes', async t => {
  const f = await fixture(t), path = join(f.root, '.agent-loom/task.json');
  const legacy = JSON.stringify({ ...f.store.task, schema_version: 2 });
  await writeFile(path, legacy);
  await assert.rejects(LocalTaskStore.open(f.root), { code: 'StorageFailure' });
  assert.equal(await readFile(path, 'utf8'), legacy);
});
