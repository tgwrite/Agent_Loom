import type { PluginDescriptor } from '../../../packages/container-core/src/index.ts';

export const postmortem: PluginDescriptor = {
  id: 'postmortem',
  role: 'aspect',
  native: { runtime: 'pi', binding_key: 'postmortem' },
  capabilities: [],
  produces: [
    { type: 'postmortem.checkpoint', version: '1' },
    { type: 'postmortem.report', version: '1' },
  ],
};
