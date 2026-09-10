// Runnable synthetic integration. For a native application, import its real Pi SDK
// and adapters and provide its modelRuntime/settings in configure().
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createPiHostModule, readArtifactFile, readTaskInput } from 'agent-loom/runtime-pi';
import { sdk } from './synthetic-sdk.mjs';
import { domains } from './domains.mjs';

export const { createSessionHost, validateNativeApplication } = createPiHostModule({
  sdk, sdkVersion: 'synthetic', preflightDirectory: import.meta.dirname,
  configure: () => ({ settings: {}, modelRuntime: undefined }),
  adapters: {
    domain: { entry: import.meta.filename,
      async create({ store }) {
        const domain = domains[store.task.application_id];
        let accepted;
        return {
          async initialize(context, artifacts) {
            if (context.plan.profile_id === 'produce') {
              assert.equal(artifacts.length, 0);
              accepted = await readTaskInput(store, domain.parse);
            } else {
              assert.equal(artifacts.length, 1);
              accepted = await readArtifactFile(context, artifacts[0],
                { ...domain.contract, verification_status: 'READY', producer_plugin_id: 'domain' },
                bytes => domain.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))));
            }
            await mkdir(context.workspace, { recursive: true });
          },
          async run(_session, context) {
            const producing = context.plan.profile_id === 'produce';
            const output = join(context.workspace, `${context.session_id}.json`);
            await writeFile(output, JSON.stringify(producing ? accepted : domain.consume(accepted)), { flag: 'wx' });
            return [{ ...(producing ? domain.contract : { type: `${store.task.application_id}.result`, version: '1' }),
              path: relative(context.task_root, output).replaceAll('\\', '/'),
              verification_status: producing ? 'READY' : 'COMPLETED' }];
          },
        };
      },
    },
  },
});
