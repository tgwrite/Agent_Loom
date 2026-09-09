import { ContainerFailure } from '../failure/index.ts';
import type { PluginDescriptor } from '../plugin/index.ts';
import type { SessionProfile } from '../session/index.ts';

export interface ApplicationDefinition {
  id: string;
  version: string;
  plugins: readonly PluginDescriptor[];
  profiles: readonly SessionProfile[];
}

export function resolveProfile(application: ApplicationDefinition, profileId: string): {
  profile: SessionProfile;
  plugins: readonly PluginDescriptor[];
} {
  const ids = application.plugins.map((plugin) => plugin.id);
  const profileIds = application.profiles.map((profile) => profile.id);
  if (new Set(ids).size !== ids.length || new Set(profileIds).size !== profileIds.length) {
    throw new ContainerFailure('BindingConflict', 'Application identifiers must be unique.');
  }
  const profile = application.profiles.find((item) => item.id === profileId);
  if (!profile) throw new ContainerFailure('InvalidDefinition', 'Session Profile is not defined.');
  const selected = [...(profile.primary ? [profile.primary] : []), ...profile.aspects];
  if (new Set(selected).size !== selected.length) {
    throw new ContainerFailure('BindingConflict', 'A Plugin is selected more than once.');
  }
  const plugins = selected.map((id) => {
    const plugin = application.plugins.find((item) => item.id === id);
    if (!plugin || plugin.role !== (id === profile.primary ? 'domain' : 'aspect')) {
      throw new ContainerFailure('InvalidDefinition', 'Profile Plugin role or binding is invalid.');
    }
    return plugin;
  });
  const bindings = new Set<string>();
  for (const plugin of plugins) {
    for (const capability of plugin.capabilities) {
      if (capability.provider !== plugin.id) {
        throw new ContainerFailure('InvalidDefinition', 'Capability provider must match its Plugin.');
      }
      const key = JSON.stringify([capability.id, capability.version]);
      if (bindings.has(key)) {
        throw new ContainerFailure('BindingConflict', 'Capability has multiple provider bindings.');
      }
      bindings.add(key);
    }
  }
  return { profile, plugins };
}
