import { ContainerFailure } from '../failure/index.ts';
import type { PluginDescriptor } from '../plugin/index.ts';
import type { SessionProfile } from '../session/index.ts';
import { taskRelativePath } from '../paths.ts';

export interface ApplicationDefinition {
  id: string;
  version: string;
  runtime: { id: string; version: string };
  plugins: readonly PluginDescriptor[];
  profiles: readonly SessionProfile[];
}

export function resolveProfile(application: ApplicationDefinition, profileId: string): {
  profile: SessionProfile;
  plugins: readonly PluginDescriptor[];
} {
  validateApplication(application);
  return selectProfile(application, profileId);
}

function selectProfile(application: ApplicationDefinition, profileId: string): {
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

function definition(condition: unknown): asserts condition {
  if (!condition) throw new ContainerFailure('InvalidDefinition', 'Application definition is malformed.');
}

function object(value: unknown): asserts value is Record<string, unknown> {
  definition(typeof value === 'object' && value !== null && !Array.isArray(value));
}

function nonempty(value: unknown): void {
  definition(typeof value === 'string' && value.trim().length > 0);
}

function id(value: unknown): void {
  definition(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value));
}

function contract(value: unknown): void {
  object(value);
  nonempty(value.type);
  nonempty(value.version);
}

/** Validates composition and the built-in registry resolver; never executes a Plugin. */
export function validateApplication(value: unknown): asserts value is ApplicationDefinition {
  object(value);
  id(value.id);
  nonempty(value.version);
  object(value.runtime);
  id(value.runtime.id);
  nonempty(value.runtime.version);
  definition(Array.isArray(value.plugins) && Array.isArray(value.profiles) && value.profiles.length > 0);
  for (const plugin of value.plugins) {
    object(plugin);
    id(plugin.id);
    definition(plugin.role === 'domain' || plugin.role === 'aspect');
    object(plugin.native);
    id(plugin.native.runtime);
    id(plugin.native.binding_key);
    definition(plugin.native.runtime === value.runtime.id);
    definition(Array.isArray(plugin.capabilities));
    for (const capability of plugin.capabilities) {
      object(capability);
      nonempty(capability.id);
      nonempty(capability.version);
      definition(capability.provider === plugin.id && Array.isArray(capability.requirements));
      for (const requirement of capability.requirements) {
        contract(requirement);
        nonempty(requirement.verification_status);
      }
    }
    if (plugin.produces !== undefined) {
      definition(Array.isArray(plugin.produces));
      plugin.produces.forEach(contract);
    }
  }
  for (const profile of value.profiles) {
    object(profile);
    id(profile.id);
    if (profile.primary !== undefined) id(profile.primary);
    definition(Array.isArray(profile.aspects) && Array.isArray(profile.requirements));
    profile.aspects.forEach(id);
    if (profile.workspace !== undefined) {
      try { taskRelativePath(profile.workspace, true); } catch {
        throw new ContainerFailure('InvalidDefinition', 'Profile Workspace must be Task-relative.');
      }
    }
    for (const requirement of profile.requirements) {
      contract(requirement);
      nonempty(requirement.verification_status);
      if (requirement.artifact_id !== undefined) id(requirement.artifact_id);
    }
  }
  const application = value as unknown as ApplicationDefinition;
  const produced = new Set(application.plugins.flatMap((plugin) =>
    (plugin.produces ?? []).map((item) => JSON.stringify([item.type, item.version]))));
  for (const profile of application.profiles) selectProfile(application, profile.id);
  const requirements = [
    ...application.profiles.flatMap((profile) => profile.requirements),
    ...application.plugins.flatMap((plugin) => plugin.capabilities.flatMap((capability) => capability.requirements)),
  ];
  for (const requirement of requirements) {
    if (!produced.has(JSON.stringify([requirement.type, requirement.version]))) {
      throw new ContainerFailure('InvalidDefinition', 'Artifact requirement has no declared producer.', {
        contract: { type: requirement.type, version: requirement.version },
      });
    }
  }
}

export function defineApplication(application: ApplicationDefinition): ApplicationDefinition {
  validateApplication(application);
  return structuredClone(application);
}
