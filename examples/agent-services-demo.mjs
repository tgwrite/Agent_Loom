// Public synthetic Agent API example. No model, credentials or native Pi required.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalTaskStore } from 'agent-loom';
import { connectLoom, createRequest } from 'agent-loom/agent';
import { application } from '../packaging/integration/measurement.mjs';
import { createSessionHost } from '../packaging/integration/host.mjs';

const root = await mkdtemp(join(tmpdir(), 'loom-agent-demo-'));
try {
  const taskId = 'measurement-demo';
  await LocalTaskStore.create(root, { schema_version: 2, id: taskId, application_id: application.id,
    application, title: 'Synthetic measurement handoff', created_at: new Date().toISOString() });
  const loom = await connectLoom({ taskRoot: root, taskId,
    host: { actor: { id: 'demo-operator' }, createHost: createSessionHost } });

  const discovered = loom.discover({ input_type: 'measurement.samples' });
  assert.equal(discovered.entries[0].entry_id, 'measurement.consume');
  const contract = loom.describe('measurement.consume');
  const missing = await loom.check(createRequest(taskId, contract.entry_id));
  assert.equal(missing.blockers[0].diagnostic.reason_code, 'MISSING_DEPENDENCY');
  assert.equal((await loom.inspect()).sessions.length, 0);

  // The caller chooses to produce a source; dependency checks never schedule it.
  const produced = await loom.invoke({ ...createRequest(taskId, 'measurement.produce'), data: { samples: [2, 3], unit: 'm' } });
  assert.equal(produced.execution.status, 'completed');
  const request = { ...createRequest(taskId, contract.entry_id),
    inputs: { source: { artifact_id: produced.artifacts[0].id } } };
  assert.equal((await loom.check(request)).blockers.length, 0);
  const consumed = await loom.invoke(request);
  assert.equal(consumed.execution.status, 'completed');

  // Reopen the Task with no Host: history and lineage are available independently.
  const cold = await connectLoom({ taskRoot: root, taskId });
  const facts = await cold.inspect({ session_id: consumed.session_id });
  assert.equal(facts.history, 'readable');
  assert.equal(facts.sessions[0].consumed[0].artifact_id, produced.artifacts[0].id);
  assert.equal(facts.sessions[0].consumed[0].producer_session_id, produced.session_id);
  assert.equal((await cold.inspect()).sessions.length, 2);
  console.log(JSON.stringify({ synthetic: true, services: ['discover', 'describe', 'check', 'invoke', 'inspect'],
    missing_input: missing.blockers[0].diagnostic.reason_code, execution: consumed.execution.status,
    source_reused: true, producer_sessions: 1, consumer_sessions: 1, cold_inspection: facts.history,
    business_acceptance: consumed.business_acceptance.status }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
