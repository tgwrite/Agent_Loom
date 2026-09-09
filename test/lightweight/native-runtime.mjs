import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = fileURLToPath(new URL('.', import.meta.url));
export const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));

// Shared native setup for both experimental arms. Its cost is not a Loom benefit.
export async function nativeRuntime(root, config) {
  const agentDir = join(root, 'pi-config');
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(root, 'metrics'), { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.LOOM_TEST_TASK_ROOT = root;
  process.env.LOOM_TEST_OBSERVER_FAULT = config.observer_fault ? '1' : '0';
  process.env.PI_SKIP_VERSION_CHECK = '1';
  process.env.PI_ARTIFACTS_VIEWER = 'none';
  const sdk = await import('@earendil-works/pi-coding-agent');
  const { InMemoryCredentialStore } = await import('@earendil-works/pi-ai');
  const sdkVersion = (await readJson(join(here, 'node_modules/@earendil-works/pi-coding-agent/package.json'))).version;
  const credentials = new InMemoryCredentialStore();
  let settings = { compaction: { enabled: false }, retry: { enabled: false }, enableInstallTelemetry: false };
  if (config.mode === 'model') {
    for (const [provider, credential] of Object.entries(await readJson(join(config.auth_source, 'auth.json')))) {
      await credentials.modify(provider, async () => credential);
    }
    const defaults = await readJson(join(config.auth_source, 'settings.json'));
    assert(defaults.defaultProvider && defaults.defaultModel, 'Pi default model required');
    settings = { ...defaults, ...settings };
  } else assert.equal(config.mode, 'scripted');
  const modelRuntime = await sdk.ModelRuntime.create({ credentials,
    modelsPath: config.mode === 'model' ? join(config.auth_source, 'models.json') : null,
    modelsStorePath: join(agentDir, 'models-cache.json'), allowModelNetwork: false, refreshOnCreate: config.mode === 'model' });
  if (config.mode === 'scripted') {
    const model = modelRuntime.getModels('openai')[0];
    assert(model);
    await modelRuntime.setRuntimeApiKey(model.provider, 'synthetic-not-a-credential');
    settings.defaultProvider = model.provider;
    settings.defaultModel = model.id;
  }
  return { sdk, sdkVersion, agentDir, settings, modelRuntime };
}
