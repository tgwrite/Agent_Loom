import type { PluginDescriptor } from '../../../packages/container-core/src/internal.ts';

export const c2forge: PluginDescriptor = {
  id: 'c2forge',
  role: 'domain',
  native: { runtime: 'pi', binding_key: 'c2forge' },

  produces: [{ type: 'c2forge.decoder-handoff', version: '3' }],
};
