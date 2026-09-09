import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { containedFile, sha256 } from '../lightweight/handoff.mjs';
import { runTools } from './decisions.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const fact = (context, output, type) => [{ type, version: '1', verification_status: 'COMPLETED',
  path: relative(context.task_root, output).replaceAll('\\', '/') }];
const prepare = async context => mkdir(join(context.workspace, context.session_id), { recursive: true });
async function accept(context, artifacts, type) {
  assert.equal(artifacts.length, 1);
  const input = artifacts[0];
  assert.equal(input.type, type);
  const bytes = await readFile(await containedFile(context.task_root, input.payload_ref.path));
  assert.equal(sha256(bytes), input.sha256);
  assert(bytes.toString().replaceAll('\\_', '_').includes('INPUT_CANARY_'));
  return bytes;
}

export function pipelineAdapters(config) {
  return {
    capture: { entry: join(here, 'node_modules/pi-web-utils/index.ts'),
      async initialize(context, artifacts) { assert.equal(artifacts.length, 0); await prepare(context); },
      async run(session, context) {
        const [result] = await runTools(session, context, [{ name: 'fetch_webpage', arguments: {
          url: config.url, output: 'markdown', preferMarkdownNew: false,
        } }]);
        assert(!result.isError && !result.details.error);
        assert.equal(result.details.source, 'direct');
        assert.equal(result.details.status, 200);
        const markdown = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
        assert(markdown.replaceAll('\\_', '_').includes('INPUT_CANARY_') && markdown.includes('Pending review.'));
        const output = join(context.workspace, context.session_id, 'snapshot.md');
        await writeFile(output, markdown, { flag: 'wx' });
        return fact(context, output, 'source.snapshot');
      },
    },
    normalize: { entry: join(here, 'node_modules/@trycedar/pi-mdiff/src/index.ts'),
      async initialize(context, artifacts) {
        await prepare(context);
        await writeFile(join(context.workspace, 'normalized.md'), await accept(context, artifacts, 'source.snapshot'), { flag: 'wx' });
      },
      async run(session, context) {
        const results = await runTools(session, context, [
          { name: 'md_inspect', arguments: { path: 'normalized.md' } },
          { name: 'md_edit', arguments: { path: 'normalized.md', operation: 'replace', section: 'Status',
            block_index: 0, content: 'Status normalized for publication.' } },
        ]);
        assert.equal(results.length, 2);
        assert(results.every(result => !result.isError));
        const output = join(context.workspace, 'normalized.md');
        const text = await readFile(output, 'utf8');
        assert(text.includes('Status normalized for publication.') && text.replaceAll('\\_', '_').includes('INPUT_CANARY_'));
        assert(!text.includes('Pending review.'));
        return fact(context, output, 'normalized.data');
      },
    },
    publish: { entry: join(here, 'node_modules/pi-markdown-preview/index.ts'),
      async initialize(context, artifacts) {
        await prepare(context);
        await writeFile(join(context.workspace, 'input.md'), await accept(context, artifacts, 'normalized.data'), { flag: 'wx' });
      },
      async run(session, context) {
        const output = join(context.workspace, context.session_id, 'final.html');
        const [result] = await runTools(session, context, [{ name: 'preview_export', arguments: {
          source: 'file', path: config.export_fault ? 'missing.md' : 'input.md', format: 'html', outputPath: output, open: false,
        } }]);
        assert(!result.isError);
        assert.deepEqual(result.details.paths, [output]);
        assert.equal(result.details.opened, false);
        const html = await readFile(output, 'utf8');
        assert(/<html[\s>]/i.test(html) && html.includes('Status normalized for publication.') && html.includes('INPUT_CANARY_'));
        return fact(context, output, 'final.output');
      },
    },
  };
}
