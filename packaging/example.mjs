// Synthetic installation example; no Pi, business plugin or model is invoked.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { LocalTaskStore, prepareSession, executeSession, inspectTask } from 'agent-loom';
import { createPiApplicationHost, PI_REFERENCE_TARGET } from 'agent-loom/runtime-pi';

assert.equal(typeof createPiApplicationHost, 'function');
assert.equal(PI_REFERENCE_TARGET, '0.85.1');
const root = resolve(process.argv[2] ?? 'sample-task');
const contract = { type: 'sample.text', version: '1' };
const application = { id: 'install-example', version: '1', runtime: { id: 'synthetic', version: '1' },
  plugins: [{ id: 'sample-domain', role: 'domain', native: { runtime: 'synthetic', binding_key: 'sample' },
    capabilities: [], produces: [contract] }],
  profiles: [
    { id: 'produce', primary: 'sample-domain', aspects: [], requirements: [] },
    { id: 'consume', primary: 'sample-domain', aspects: [], requirements: [{ ...contract, verification_status: 'READY' }] },
  ] };
const store = await LocalTaskStore.create(root, { schema_version: 2, id: 'install-example', application_id: application.id,
  application, title: 'Synthetic package installation check', created_at: new Date().toISOString() });
const payload = 'Synthetic package handoff';
const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const host = {
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
          producer: { plugin_id: 'sample-domain', capability_id: 'synthetic-publish', session_id: binding.session_id },
          executor: { actor_id: binding.actor.id, runtime_id: host.runtime.id }, verification: { status: 'READY' },
          payload_ref: { kind: 'inline', value: payload }, sha256: digest, created_at: new Date().toISOString() });
        return { status: 'completed' };
      },
      async close() {},
    };
  },
};
for (const profile of ['produce', 'consume']) await executeSession(store, await prepareSession(store, profile), host, { id: 'sample-operator' });
const snapshot = await inspectTask(await LocalTaskStore.open(root));
assert.equal(snapshot.sessions.length, 2);
assert(snapshot.sessions.every(s => s.status === 'completed'));
assert.equal(snapshot.artifacts.length, 1);
assert.equal(snapshot.sessions.flatMap(s => s.consumed).length, 1);
console.log(JSON.stringify({ synthetic: true, sessions: 2, artifacts: 1, consumptions: 1, native_plugins_executed: false }));
