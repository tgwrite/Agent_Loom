import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalTaskStore, resolveProfile } from '../../packages/container-core/src/index.ts';
import { c2AnalysisApplication } from './application.ts';
import { decoderHandoffRequirement } from '../../adapters/c2decoder-pi/src/index.ts';

const root = await mkdtemp(join(tmpdir(), 'agent-loom-demo-'));
const timestamp = '2026-01-01T00:00:00.000Z';
try {
  const store = await LocalTaskStore.create(root, { schema_version: 2, id: 'demo-task',
    application_id: 'c2-analysis', application: c2AnalysisApplication,
    title: 'Synthetic Artifact handoff', created_at: timestamp });
  const producer = resolveProfile(c2AnalysisApplication, 'c2forge');
  const actor = { id: 'demo-actor' };
  const runtime = { id: 'demo-runtime', name: 'synthetic', version: '1' };
  await store.startSession({ id: 'producer-session', task_id: store.task.id,
    profile_id: producer.profile.id, plugin_ids: producer.plugins.map((plugin) => plugin.id),
    workspace: '.', primary_plugin_id: 'c2forge', aspect_plugin_ids: ['postmortem'],
    actor, runtime, status: 'running', started_at: timestamp });
  // This payload is deliberately not a real domain Handoff or proof.
  const payload = JSON.stringify({ synthetic: true, description: 'Governance example only' });
  await writeFile(join(root, 'synthetic-handoff.json'), payload);
  await store.publishArtifact({ id: 'demo-handoff', task_id: store.task.id,
    type: 'c2forge.decoder-handoff', version: '3',
    producer: { plugin_id: 'c2forge', capability_id: 'synthetic-publication', session_id: 'producer-session' },
    executor: { actor_id: actor.id, runtime_id: runtime.id }, verification: { status: 'READY' },
    payload_ref: { kind: 'file', path: 'synthetic-handoff.json' },
    sha256: createHash('sha256').update(payload).digest('hex'), created_at: timestamp });
  await store.settleSession('producer-session', 'completed', timestamp);

  const reopened = await LocalTaskStore.open(root);
  const reference = await reopened.resolveArtifact(decoderHandoffRequirement);
  const consumer = resolveProfile(c2AnalysisApplication, 'c2decoder');
  await reopened.startSession({ id: 'consumer-session', task_id: reopened.task.id,
    profile_id: consumer.profile.id, plugin_ids: consumer.plugins.map((plugin) => plugin.id),
    workspace: 'decoder-workspace', primary_plugin_id: 'c2decoder', aspect_plugin_ids: ['postmortem'],
    actor, runtime, status: 'running', started_at: timestamp });
  // Simulate a successful initializer receipt; this does not establish domain trust.
  await reopened.recordConsumption({ id: 'demo-consumption', task_id: reopened.task.id,
    session_id: 'consumer-session', consumer_plugin_id: 'c2decoder', artifact_id: reference.id,
    sha256: reference.sha256, consumed_at: timestamp });
  await reopened.settleSession('consumer-session', 'completed', timestamp);
  console.log(JSON.stringify({ synthetic: true, task: reopened.task.id,
    sessions: (await reopened.listSessions()).length, artifact: reference.id,
    producer_session: (await reopened.listArtifacts())[0]?.producer.session_id,
    consumer_session: (await reopened.listConsumptions())[0]?.session_id,
    native_plugins_executed: false }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
