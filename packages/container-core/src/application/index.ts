import { ContainerFailure } from '../failure/index.ts';
import type { PluginDescriptor } from '../plugin/index.ts';
import type { SessionProfile } from '../session/index.ts';
import { taskRelativePath } from '../paths.ts';
import { validateDataSchema } from '../data-schema.ts';

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
  return { profile, plugins };
}

function definition(condition: unknown, path: string, rule: string): asserts condition {
  if (!condition) throw new ContainerFailure('InvalidDefinition',
    `Application definition is malformed at ${path} (${rule}).`, { path, rule });
}

function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  definition(typeof value === 'object' && value !== null && !Array.isArray(value), path, 'expected-object');
}

function nonempty(value: unknown, path: string): void {
  definition(typeof value === 'string' && value.trim().length > 0, path, 'expected-nonempty-string');
}

function id(value: unknown, path: string): void {
  definition(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value), path, 'invalid-identifier');
}

function contract(value: unknown, path: string): void {
  object(value, path);
  nonempty(value.type, `${path}.type`);
  nonempty(value.version, `${path}.version`);
}

/** Validates composition and the built-in registry resolver; never executes a Plugin. */
export function validateApplication(value: unknown): asserts value is ApplicationDefinition {
  object(value, '$');
  id(value.id, 'id');
  nonempty(value.version, 'version');
  object(value.runtime, 'runtime');
  id(value.runtime.id, 'runtime.id');
  nonempty(value.runtime.version, 'runtime.version');
  definition(Array.isArray(value.plugins), 'plugins', 'expected-array');
  definition(Array.isArray(value.profiles) && value.profiles.length > 0, 'profiles', 'expected-nonempty-array');
  for (const [index, plugin] of value.plugins.entries()) {
    const path = `plugins[${index}]`;
    object(plugin, path);
    id(plugin.id, `${path}.id`);
    definition(plugin.role === 'domain' || plugin.role === 'aspect', `${path}.role`, 'unsupported-value');
    object(plugin.native, `${path}.native`);
    id(plugin.native.runtime, `${path}.native.runtime`);
    id(plugin.native.binding_key, `${path}.native.binding_key`);
    definition(plugin.native.runtime === value.runtime.id, `${path}.native.runtime`, 'runtime-mismatch');
    definition(plugin.capabilities === undefined, `${path}.capabilities`, 'removed-in-v02');
    if (plugin.produces !== undefined) {
      definition(Array.isArray(plugin.produces), `${path}.produces`, 'expected-array');
      for (const [outputIndex, output] of plugin.produces.entries()) contract(output, `${path}.produces[${outputIndex}]`);
    }
  }
  for (const [index, profile] of value.profiles.entries()) {
    const path = `profiles[${index}]`;
    object(profile, path);
    id(profile.id, `${path}.id`);
    if (profile.entry !== undefined) {
      const entryPath = `${path}.entry`;
      object(profile.entry, entryPath);
      definition(typeof profile.entry.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(profile.entry.id), `${entryPath}.id`, 'invalid-identifier');
      definition(Object.keys(profile.entry).every(key => ['id', 'request_mapping', 'data_schema', 'data_required'].includes(key)), entryPath, 'unknown-entry-field');
      definition(profile.entry.request_mapping === undefined || profile.entry.request_mapping === 'v1', `${entryPath}.request_mapping`, 'unsupported-value');
      if (profile.entry.data_required !== undefined) definition(typeof profile.entry.data_required === 'boolean', `${entryPath}.data_required`, 'expected-boolean');
      if (profile.entry.data_schema !== undefined || profile.entry.data_required)
        definition(profile.entry.request_mapping === 'v1', `${entryPath}.request_mapping`, 'data-contract-requires-v1');
      if (profile.entry.data_schema !== undefined) validateDataSchema(profile.entry.data_schema, `${entryPath}.data_schema`);
    }
    if (profile.primary !== undefined) id(profile.primary, `${path}.primary`);
    definition(Array.isArray(profile.aspects), `${path}.aspects`, 'expected-array');
    definition(Array.isArray(profile.requirements), `${path}.requirements`, 'expected-array');
    for (const [aspectIndex, aspect] of profile.aspects.entries()) id(aspect, `${path}.aspects[${aspectIndex}]`);
    if (profile.workspace !== undefined) {
      try { taskRelativePath(profile.workspace, true); } catch {
        definition(false, `${path}.workspace`, 'expected-task-relative-path');
      }
    }
    for (const [requirementIndex, requirement] of profile.requirements.entries()) {
      const reqPath = `${path}.requirements[${requirementIndex}]`;
      contract(requirement, reqPath);
      definition(Object.keys(requirement).every(key => ['type', 'version', 'input_name', 'assertion_status', 'producer_plugin_id', 'artifact_id'].includes(key)), reqPath, 'unknown-requirement-field');
      if (requirement.assertion_status !== undefined) nonempty(requirement.assertion_status, `${reqPath}.assertion_status`);
      if (requirement.producer_plugin_id !== undefined) id(requirement.producer_plugin_id, `${reqPath}.producer_plugin_id`);
      if (requirement.artifact_id !== undefined) id(requirement.artifact_id, `${reqPath}.artifact_id`);
      if (requirement.input_name !== undefined) id(requirement.input_name, `${reqPath}.input_name`);
    }
  }
  const application = value as unknown as ApplicationDefinition;
  const entries = application.profiles.map(profile => profile.entry?.id ?? profile.id);
  definition(new Set(entries).size === entries.length, 'profiles', 'duplicate-entry-id');
  for (const [index, profile] of application.profiles.entries()) {
    const names = profile.requirements.map(r => r.input_name).filter(name => name !== undefined);
    definition(new Set(names).size === names.length, `profiles[${index}].requirements`, 'duplicate-input-name');
  }
  for (const profile of application.profiles) selectProfile(application, profile.id);
  const requirements = application.profiles.flatMap(profile => profile.requirements);
  for (const requirement of requirements) {
    if (!application.plugins.some(plugin =>
      (requirement.producer_plugin_id === undefined || plugin.id === requirement.producer_plugin_id)
      && plugin.produces?.some(output => output.type === requirement.type && output.version === requirement.version))) {
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
