import type { ArtifactContract } from '../artifact/index.ts';

export interface PluginDescriptor {
  id: string;
  role: 'domain' | 'aspect';
  native: { runtime: string; binding_key: string };
  produces?: readonly ArtifactContract[];
}
