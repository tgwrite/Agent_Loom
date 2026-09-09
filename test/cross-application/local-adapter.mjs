import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTools } from './decisions.mjs';

export function localAdapter(config) {
  return { entry: fileURLToPath(new URL('./json-native.ts', import.meta.url)),
    async initialize(context, artifacts) {
      assert.equal(artifacts.length, 0);
      await mkdir(join(context.workspace, context.session_id), { recursive: true });
      const fixture = await readFile(join(context.task_root, 'fixture.json'), 'utf8');
      assert.deepEqual(JSON.parse(fixture).items, [{ name: 'sample', value: 7 }, { name: 'extra', value: 11 }]);
      await writeFile(join(context.workspace, 'input.json'), fixture);
    },
    async run(session, context) {
      const results = await runTools(session, context, [{ name: 'json_query', arguments: {
        file: join(context.workspace, config.export_fault ? 'missing.json' : 'input.json'), query: '.items[0]',
      } }]);
      assert.equal(results.length, 1);
      assert(!results[0].isError);
      assert.deepEqual(results[0].details.value, { name: 'sample', value: 7 });
      const output = join(context.workspace, context.session_id, 'local-result.json');
      await writeFile(output, JSON.stringify(results[0].details.value) + '\n', { flag: 'wx' });
      return [{ type: 'local.result', version: '1', verification_status: 'COMPLETED',
        path: relative(context.task_root, output).replaceAll('\\', '/') }];
    },
  };
}
