import type { ArtifactRequirement, PluginDescriptor } from '../../../packages/container-core/src/index.ts';

export const c2decoder: PluginDescriptor = {
  id: 'c2decoder',
  role: 'domain',
  native: { runtime: 'pi', binding_key: 'c2decoder' },
  capabilities: [],
};

// This describes the baseline requirement; native schema mapping awaits Phase 0.
export const decoderHandoffRequirement: ArtifactRequirement = {
  type: 'DecoderHandoffView',
  version: '3',
  verification_status: 'READY',
};
