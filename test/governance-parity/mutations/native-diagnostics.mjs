// Post-campaign consequence probes. These do not change frozen regression scores.
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';
const campaign = process.argv[2];
const rows = JSON.parse(await readFile(join(campaign, 'results.local.json')));
const results = [];
async function command(root, args, env) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    const timer = setTimeout(() => child.kill(), 180000);
    child.on('error', fail); child.on('close', code => { clearTimeout(timer); done({ code, stdout, stderr }); });
  });
}
for (const id of ['M10', 'M11', 'M16']) for (const arm of ['loom', 'control']) {
  const row = rows.find(r => r.mutation_id === id && r.arm === arm), root = resolve(row.output);
  const built = await command(root, [resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], {});
  if (built.code !== 0) throw new Error(built.stdout + built.stderr);
  for (const app of ['a', 'b', 'c']) {
    const scenario = id === 'M10' ? 'after-run' : id === 'M11' ? 'domain-failure' : 'normal';
    const ran = await command(root, ['test/governance-parity/native.mjs'], { PARITY_ARM: arm, PARITY_APP: app, PARITY_SCENARIO: scenario });
    const folders = await readdir(join(root, '.test-tmp/governance-parity/native'));
    const candidates = await Promise.all(folders.map(async name => ({ name, time: (await stat(join(root, '.test-tmp/governance-parity/native', name))).mtimeMs })));
    const folder = join(root, '.test-tmp/governance-parity/native', candidates.sort((a, b) => b.time - a.time)[0].name);
    const commands = JSON.parse(await readFile(join(folder, 'commands.local.json'))), taskRoot = join(folder, `${arm}-${app}-${scenario}`);
    let sessions, tasks;
    if (arm === 'control') { const state = JSON.parse(await readFile(join(taskRoot, '.control/state.json'))); sessions = state.sessions; tasks = state.task; }
    else {
      tasks = JSON.parse(await readFile(join(taskRoot, '.agent-loom/task.json')));
      sessions = await Promise.all((await readdir(join(taskRoot, '.agent-loom/sessions'))).map(id => readFile(join(taskRoot, '.agent-loom/sessions', id, 'session.json')).then(JSON.parse)));
    }
    const requests = (await readFile(join(taskRoot, 'external-provider-requests.local.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    const metadataInMain = requests.some(r => JSON.stringify(r.input).includes(JSON.stringify(JSON.stringify(tasks)).slice(1, -1)));
    const result = { mutation_id: id, arm, application: app, scenario, frozen_native_driver_exit: ran.code,
      sessions: sessions.map(s => ({ profile: s.profile_id, status: s.status })), metadata_in_main: metadataInMain,
      start_commands: commands.filter(c => c.operation === 'start').map(c => ({ profile: c.profile, code: c.code })), output: relative('.', folder) };
    results.push(result); await writeFile(join(campaign, 'native-diagnostics.local.json'), JSON.stringify(results, null, 2));
    console.log(`${id} ${arm}/${app}: driver=${ran.code} metadata=${metadataInMain} ${JSON.stringify(result.sessions)}`);
  }
}
