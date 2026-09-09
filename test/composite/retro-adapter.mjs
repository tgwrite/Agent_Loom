import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { here } from './launcher.mjs';

const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

// Native command binding and native file assertions only. No Loom imports,
// registry, event persistence, producer identity or Session settlement here.
export function retroAdapter(config) {
  return { entry: join(here, 'node_modules/pi-conversation-retro/extensions/index.ts'),
    async afterRun(session, context) {
      const command = session.extensionRunner.getCommand('conversation-retro');
      assert(command && session.sessionFile, 'Native review command and log required');
      const input = join(context.workspace, 'retro-input', context.session_id);
      const sessions = join(input, 'sessions');
      await mkdir(dirname(input), { recursive: true });
      await mkdir(input);
      await mkdir(sessions);
      const source = join(sessions, basename(session.sessionFile));
      await copyFile(session.sessionFile, source);
      const header = JSON.parse((await readFile(source, 'utf8')).split('\n')[0]);
      assert.equal(header.cwd, context.workspace, 'Only the current native Session is eligible');
      await writeJson(join(input, 'settings.json'), { defaultProvider: 'loom-retro-test', defaultModel: 'retro-fixture',
        compaction: { enabled: false }, retry: { enabled: false }, enableInstallTelemetry: false });
      await writeJson(join(input, 'auth.json'), {});
      await writeJson(join(input, 'models.json'), { providers: { 'loom-retro-test': {
        baseUrl: config.review_provider, api: 'openai-completions', apiKey: 'synthetic-not-a-credential',
        models: [{ id: 'retro-fixture', name: 'Local review fixture', reasoning: false, input: ['text'],
          contextWindow: 200000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      } } });
      const outputArg = `retro-output/${context.session_id}`;
      const output = join(context.workspace, outputArg);
      // An existing directory is not a new successful native publication.
      await mkdir(output, { recursive: false }).catch(async error => {
        if (error.code !== 'ENOENT') throw error;
        await mkdir(dirname(output), { recursive: true });
        await mkdir(output);
      });
      const temp = join(input, 'temp');
      await mkdir(temp);
      const overrides = { PI_CODING_AGENT_DIR: input, GIT_CEILING_DIRECTORIES: dirname(context.workspace),
        TMP: temp, TEMP: temp, TMPDIR: temp, LOOM_TEST_CHILD_TRACE: temp, ...config.launcher_env };
      const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
      const runner = session.extensionRunner;
      const previousUi = runner.hasUI() ? runner.getUIContext() : undefined;
      const diagnostics = [];
      try {
        Object.assign(process.env, overrides);
        runner.setUIContext({ ...runner.getUIContext(), setStatus() {}, setWidget() {},
          notify(message, level) { diagnostics.push({ message, level }); } }, 'rpc');
        await command.handler(`--days 1 --concurrency 1 --limit 1 --timeout 1 --output ${outputArg}`,
          session.extensionRunner.createCommandContext());
      } finally {
        runner.setUIContext(previousUi, 'rpc');
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        await writeJson(join(input, 'diagnostics.local.json'), diagnostics);
      }
      const summaryName = basename(source, '.jsonl') + '.md';
      const files = await readdir(output);
      const reportNames = files.filter(name => /^workflow-improvement-report-\d{8}-\d{6}\.md$/.test(name));
      assert.equal(reportNames.length, 1, 'Native review did not complete');
      assert(files.includes(summaryName), 'Native session review missing');
      const summary = await readFile(join(output, summaryName), 'utf8');
      assert(summary.startsWith(`<!-- source_session: ${source} -->`), 'Native review source mismatch');
      const report = await readFile(join(output, reportNames[0]), 'utf8');
      assert(report.trim() && report === await readFile(join(output, 'workflow-improvement-report-latest.md'), 'utf8'));
      return [[summaryName, 'retro.session-review'], [reportNames[0], 'retro.improvement-report']].map(([name, type]) => ({
        type, version: '1', verification_status: 'COMPLETED',
        path: relative(context.task_root, join(output, name)).replaceAll('\\', '/'),
      }));
    },
  };
}
