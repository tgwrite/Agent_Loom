import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { LocalTaskStore } from '../packages/container-core/src/index.ts';
import type { ArtifactRecord, SessionRunRecord } from '../packages/container-core/src/index.ts';

export const timestamp = '2026-01-01T00:00:00.000Z';

export async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'agent-loom-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await LocalTaskStore.create(root, { schema_version: 1, id: 'task-one',
    application_id: 'test-app', title: 'Synthetic Task', created_at: timestamp });
  return { root, store };
}

export function session(id = 'producer'): SessionRunRecord {
  return { id, task_id: 'task-one', profile_id: 'test-profile', plugin_ids: ['test-domain'],
    actor: { id: 'test-actor' }, runtime: { id: 'test-runtime', name: 'synthetic', version: '1' },
    status: 'running', started_at: timestamp };
}

export function artifact(id = 'artifact-one'): ArtifactRecord {
  return { id, task_id: 'task-one', type: 'SyntheticHandoff', version: '3',
    producer: { plugin_id: 'test-domain', capability_id: 'synthetic-publish', session_id: 'producer' },
    executor: { actor_id: 'test-actor', runtime_id: 'test-runtime' }, verification: { status: 'READY' },
    payload_ref: { kind: 'file', path: 'fixtures/synthetic-handoff.json' },
    sha256: 'a'.repeat(64), created_at: timestamp };
}

export const requirement = { type: 'SyntheticHandoff', version: '3', verification_status: 'READY' };
