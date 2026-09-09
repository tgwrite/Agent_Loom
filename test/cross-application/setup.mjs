import { setup as priorSetup } from '../reuse/setup.mjs';
import { retroAdapter } from '../composite/retro-adapter.mjs';
import { instrument } from '../composite/instrumentation.mjs';
import { localAdapter } from './local-adapter.mjs';
import { pipelineAdapters } from './pipeline-adapters.mjs';

// Shared by Loom and the shared no-Loom control. No governance writes.
export async function setup(root, config) {
  const runtime = await priorSetup(root, config);
  if (config.app_key === 'a') return runtime;
  // Native preview export reads the SDK theme even in headless mode.
  runtime.sdk.initTheme('dark', false);
  const domains = config.app_key === 'b' ? { 'local-json': localAdapter(config) } : pipelineAdapters(config);
  const observations = new WeakMap();
  for (const adapter of Object.values(domains)) {
    const run = adapter.run;
    adapter.run = (session, context) => {
      observations.set(session, instrument(session, context));
      return run(session, context);
    };
  }
  const retro = retroAdapter(config), afterRun = retro.afterRun;
  retro.afterRun = (session, context) => observations.get(session).checkReview(() => afterRun(session, context));
  Object.assign(runtime.adapters, domains, { retro });
  return runtime;
}
