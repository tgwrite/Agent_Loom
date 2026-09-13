// Synthetic installation example; no Pi, business plugin or model is invoked.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createTask, connectLoom, createRequest } from 'agent-loom';
import { createPiApplicationHost, PI_REFERENCE_TARGET } from 'agent-loom/runtime-pi';

assert.equal(typeof createPiApplicationHost, 'function');
assert.equal(PI_REFERENCE_TARGET, '0.85.1');
const root = resolve(process.argv[2] ?? 'sample-task');
const contract = { type: 'sample.text', version: '1' };
const application = { id: 'install-example', version: '1', runtime: { id: 'synthetic', version: '1' },
  plugins: [{ id: 'sample-domain', role: 'domain', native: { runtime: 'synthetic', binding_key: 'sample' },
     produces: [contract] }],
  profiles: [
    { id: 'produce', primary: 'sample-domain', aspects: [], requirements: [], entry: { id: 'produce', request_mapping: 'v1' } },
    { id: 'consume', primary: 'sample-domain', aspects: [], requirements: [{ ...contract, producer_plugin_id: 'sample-domain', assertion_status: 'READY' }], entry: { id: 'consume', request_mapping: 'v1' } },
  ] };
const task = await createTask({ taskRoot: root, taskId: 'install-example', application, title: 'Synthetic package installation check' });
const payload = 'Synthetic package handoff';
const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const binding = { actor: { id: 'sample-operator' }, createHost({ store }) {
const host = {
  request_mapping: 'v1',
  runtime: { id: 'sample-runtime', name: 'synthetic', version: '1' },
  async validate() {},
  async launch(plan, workspace, binding) {
    return {
      runtime_session_id: `synthetic-${binding.session_id}`,
      async initialize(artifacts) {
        if (plan.profile_id === 'consume') {
          assert.equal(artifacts.length, 1);
          assert.equal(artifacts[0].payload_ref.kind, 'inline');
          assert.equal(artifacts[0].payload_ref.value, payload);
          assert.equal(createHash('sha256').update(JSON.stringify(artifacts[0].payload_ref.value)).digest('hex'), artifacts[0].sha256);
        } else assert.equal(artifacts.length, 0);
      },
      async run() {
        if (plan.profile_id === 'produce') await store.publishArtifact({ ...contract, id: 'sample-artifact', task_id: store.task.id,
          producer: { plugin_id: 'sample-domain', session_id: binding.session_id },
          executor: { actor_id: binding.actor.id, runtime_id: host.runtime.id }, assertion: { status: 'READY' },
          payload_ref: { kind: 'inline', value: payload }, sha256: digest, created_at: new Date().toISOString() });
        return { status: 'completed' };
      },
      async close() {},
    };
  },
};
return host;
} };
const loom = await connectLoom({ taskRoot: root, taskId: task.id, host: binding });
for (const profile of ['produce', 'consume']) {
  const receipt = await loom.invoke(createRequest(task.id, profile));
  assert.equal(receipt.execution.status, 'completed');
}
const snapshot = await (await connectLoom({ taskRoot: root, taskId: task.id })).inspect();
assert.equal(snapshot.sessions.length, 2);
assert.equal(snapshot.artifacts.length, 1);
assert.equal(snapshot.sessions.flatMap(s => s.consumed).length, 1);
console.log(JSON.stringify({ synthetic: true, sessions: 2, artifacts: 1, consumptions: 1, native_plugins_executed: false }));
