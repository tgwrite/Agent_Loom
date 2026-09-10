import { appendFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setup as originalSetup } from '../cross-application/setup.mjs';
import { interceptIO, writeKind } from './probes.mjs';

// Shared observation/fault injection only. Native adapters and their guards are unchanged.
export async function setup(root, config) {
  const runtime = await originalSetup(root, config);
  const create = runtime.sdk.createAgentSession;
  runtime.sdk = { ...runtime.sdk, async createAgentSession(options) {
    const value = await create(options), session = value.session;
    const prompt = session.prompt.bind(session);
    session.prompt = async (...args) => {
      const descriptor = Object.getOwnPropertyDescriptor(session.agent, 'streamFunction');
      const stream = session.agent.streamFunction;
      Object.defineProperty(session.agent, 'streamFunction', { configurable: true, writable: true, value: (model, input, opts) => {
        appendFileSync(join(root, 'external-provider-requests.local.jsonl'), JSON.stringify({ native_session_id: options.sessionManager.getSessionId(), input }) + '\n');
        return stream(model, input, opts);
      } });
      try { return await prompt(...args); }
      finally { if (descriptor) Object.defineProperty(session.agent, 'streamFunction', descriptor); else delete session.agent.streamFunction; }
    };
    return value;
  } };
  if (config.governance_delay) {
    let hit = false;
    interceptIO(async (name, args) => {
      if (hit || writeKind(name, args) !== 'terminal') return;
      hit = true; await writeFile(join(root, 'barrier-entered.local.json'), JSON.stringify({ reached: true }));
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        try { await readFile(join(root, 'barrier-release.local.json')); return; }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
        await new Promise(done => setTimeout(done, 10));
      }
      throw new Error('External settlement barrier was not released');
    });
  }
  return runtime;
}
