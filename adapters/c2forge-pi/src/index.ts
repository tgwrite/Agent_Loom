import type { PluginDescriptor } from '../../../packages/container-core/src/index.ts';

export const c2forge: PluginDescriptor = {
  id: 'c2forge',
  role: 'domain',
  native: { runtime: 'pi', binding_key: 'c2forge' },
  capabilities: [],
  produces: [{ type: 'c2forge.decoder-handoff', version: '3' }],
};
