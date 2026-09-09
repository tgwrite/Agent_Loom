import type { CapabilityDefinition } from '../capability/index.ts';

export interface PluginDescriptor {
  id: string;
  role: 'domain' | 'aspect';
  native: { runtime: 'pi'; binding_key: string };
  capabilities: readonly CapabilityDefinition[];
}
