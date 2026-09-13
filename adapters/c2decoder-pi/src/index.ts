import type { ArtifactRequirement, PluginDescriptor } from '../../../packages/container-core/src/internal.ts';

export const c2decoder: PluginDescriptor = {
  id: 'c2decoder',
  role: 'domain',
  native: { runtime: 'pi', binding_key: 'c2decoder' },

  produces: [],
};

// This describes the baseline requirement; native schema mapping awaits Phase 0.
export const decoderHandoffRequirement: ArtifactRequirement = {
  type: 'c2forge.decoder-handoff',
  version: '3',
  assertion_status: 'READY',
};
