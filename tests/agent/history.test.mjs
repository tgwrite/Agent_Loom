import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { historyFixture, measureHistory } from '../../scripts/benchmark-inspection.mjs';
import { inspectTask } from '../../dist/packages/container-core/src/index.js';

test('one inspection reads each Session once without caching across queries', async t => {
  const measured = await measureHistory(50);
  assert.equal(measured.sessions, 50); assert.equal(measured.session_record_reads, 50);
  const f = await historyFixture(3); t.after(f.cleanup);
  const first = await inspectTask(f.store);
  assert.equal(first.artifacts[0].consumers.length, 1);
  const path = join(f.store.taskRoot, '.agent-loom', 'sessions', 'session-0', 'session.json');
  const record = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...record, workspace: 'changed' }));
  assert.equal((await inspectTask(f.store)).sessions.find(session => session.id === 'session-0').workspace, 'changed');
});

test('indexed inspection retains duplicate, digest, Session and event provenance checks', async t => {
  for (const mode of ['duplicate', 'digest', 'missing-session', 'event-owner', 'truncated']) {
    const f = await historyFixture(2); t.after(f.cleanup);
    const root = join(f.store.taskRoot, '.agent-loom');
    if (mode === 'event-owner') {
      const path = join(root, 'sessions', 'session-0', 'events.jsonl');
      await writeFile(path, (await readFile(path, 'utf8')).replaceAll('"actor_id":"actor"', '"actor_id":"other"'));
    } else {
      const path = join(root, mode === 'duplicate' || mode === 'truncated' ? 'artifacts.jsonl' : 'consumptions.jsonl');
      const raw = await readFile(path, 'utf8');
      const records = raw.trim().split('\n').map(line => JSON.parse(line));
      if (mode === 'duplicate') records.push(records[0]);
      if (mode === 'digest') records[0].sha256 = 'b'.repeat(64);
      if (mode === 'missing-session') records[0].session_id = 'missing';
      await writeFile(path, mode === 'truncated' ? raw.slice(0, -1) : records.map(record => JSON.stringify(record) + '\n').join(''));
    }
    await assert.rejects(inspectTask(f.store), error => ['StorageFailure', 'InvalidRecord'].includes(error.code));
  }
});
