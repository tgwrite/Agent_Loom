import type { ArtifactRequirement, PluginDescriptor } from '../../../packages/container-core/src/index.ts';

export const c2decoder: PluginDescriptor = {
  id: 'c2decoder',
  role: 'domain',
  native: { runtime: 'pi', binding_key: 'c2decoder' },
  capabilities: [],
  produces: [],
};

// This describes the baseline requirement; native schema mapping awaits Phase 0.
export const decoderHandoffRequirement: ArtifactRequirement = {
  type: 'c2forge.decoder-handoff',
  version: '3',
  verification_status: 'READY',
};
