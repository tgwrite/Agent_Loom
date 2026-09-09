import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalTaskStore, executeSession, prepareSession, resolveTaskPath } from '../../dist/packages/container-core/src/index.js';
import { artifact, session, timestamp } from '../helpers.ts';

const [operation, root] = process.argv.slice(2);
const store = await LocalTaskStore.open(root);
if (operation === 'produce') {
  await mkdir(join(root, 'fixtures'));
  const payload = JSON.stringify({ synthetic: true });
  await writeFile(join(root, 'fixtures', 'synthetic-handoff.json'), payload);
  await store.startSession(session());
  await store.publishArtifact({ ...artifact(), sha256: createHash('sha256').update(payload).digest('hex') });
  await store.settleSession('producer', 'completed', timestamp);
} else if (operation === 'consume') {
  const plan = await prepareSession(store, 'test-consumer');
  await executeSession(store, plan, {
    runtime: { id: 'synthetic-runtime', name: 'synthetic', version: '1' },
    async validate() {},
    async launch(_plan, workspace) {
      await mkdir(workspace, { recursive: true });
      return {
        runtime_session_id: 'synthetic-native-session',
        async initialize(references) {
          for (const reference of references) {
            if (reference.payload_ref.kind !== 'file') throw new Error('Expected a synthetic file.');
            const bytes = await readFile(resolveTaskPath(root, reference.payload_ref.path));
            if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256) throw new Error('Synthetic digest mismatch.');
          }
        },
        async run() { return { status: 'completed' }; },
        async close() {},
      };
    },
  }, { id: 'synthetic-consumer' });
} else {
  throw new Error('Unknown fixture operation.');
}
console.log(JSON.stringify({ operation, synthetic: true }));
