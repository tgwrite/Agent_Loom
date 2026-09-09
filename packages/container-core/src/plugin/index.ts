import type { CapabilityDefinition } from '../capability/index.ts';
import type { ArtifactContract } from '../artifact/index.ts';

export interface PluginDescriptor {
  id: string;
  role: 'domain' | 'aspect';
  native: { runtime: string; binding_key: string };
  capabilities: readonly CapabilityDefinition[];
  produces?: readonly ArtifactContract[];
}
