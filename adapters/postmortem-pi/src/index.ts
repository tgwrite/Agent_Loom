import type { PluginDescriptor } from '../../../packages/container-core/src/index.ts';

export const postmortem: PluginDescriptor = {
  id: 'postmortem',
  role: 'aspect',
  native: { runtime: 'pi', binding_key: 'postmortem' },
  capabilities: [],
};
