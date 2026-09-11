import { ContainerFailure } from '../failure/index.ts';
import type { PluginDescriptor } from '../plugin/index.ts';
import type { SessionProfile } from '../session/index.ts';
import { taskRelativePath } from '../paths.ts';
import { validateData, validateDataSchema } from '../data-schema.ts';
import { jsonValue } from '../record-validation.ts';

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
    definition(Array.isArray(plugin.capabilities), `${path}.capabilities`, 'expected-array');
    for (const [capabilityIndex, capability] of plugin.capabilities.entries()) {
      const capPath = `${path}.capabilities[${capabilityIndex}]`;
      object(capability, capPath);
      nonempty(capability.id, `${capPath}.id`);
      nonempty(capability.version, `${capPath}.version`);
      definition(capability.provider === plugin.id, `${capPath}.provider`, 'provider-mismatch');
      definition(Array.isArray(capability.requirements), `${capPath}.requirements`, 'expected-array');
      for (const [requirementIndex, requirement] of capability.requirements.entries()) {
        const reqPath = `${capPath}.requirements[${requirementIndex}]`;
        contract(requirement, reqPath);
        nonempty(requirement.verification_status, `${reqPath}.verification_status`);
      }
    }
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
      nonempty(profile.entry.purpose, `${entryPath}.purpose`);
      definition(profile.entry.implementation === 'native' || profile.entry.implementation === 'synthetic', `${entryPath}.implementation`, 'expected-native-or-synthetic');
      definition(profile.entry.request_mapping === undefined || profile.entry.request_mapping === 'v1', `${entryPath}.request_mapping`, 'unsupported-value');
      if (profile.entry.data_required !== undefined) definition(typeof profile.entry.data_required === 'boolean', `${entryPath}.data_required`, 'expected-boolean');
      if (profile.entry.data_schema !== undefined || profile.entry.data_required || profile.entry.data_examples !== undefined)
        definition(profile.entry.request_mapping === 'v1', `${entryPath}.request_mapping`, 'data-contract-requires-v1');
      if (profile.entry.data_schema !== undefined) validateDataSchema(profile.entry.data_schema, `${entryPath}.data_schema`);
      if (profile.entry.data_examples !== undefined) {
        definition(Array.isArray(profile.entry.data_examples), `${entryPath}.data_examples`, 'expected-array');
        for (const [exampleIndex, example] of profile.entry.data_examples.entries()) {
          try {
            jsonValue(example);
            if (profile.entry.data_schema !== undefined) validateData(profile.entry.data_schema, example);
          } catch { definition(false, `${entryPath}.data_examples[${exampleIndex}]`, 'example-does-not-match-data-contract'); }
        }
      }
      if (profile.entry.acceptance_artifacts !== undefined) {
        definition(Array.isArray(profile.entry.acceptance_artifacts), `${entryPath}.acceptance_artifacts`, 'expected-array');
        for (const [evidenceIndex, evidence] of profile.entry.acceptance_artifacts.entries()) {
          const evidencePath = `${entryPath}.acceptance_artifacts[${evidenceIndex}]`;
          contract(evidence, evidencePath);
          id(evidence.producer_plugin_id, `${evidencePath}.producer_plugin_id`);
        }
      }
      definition(Array.isArray(profile.entry.effect_declarations), `${entryPath}.effect_declarations`, 'expected-array');
      for (const [effectIndex, effect] of profile.entry.effect_declarations.entries()) nonempty(effect, `${entryPath}.effect_declarations[${effectIndex}]`);
      if (profile.entry.name !== undefined) nonempty(profile.entry.name, `${entryPath}.name`);
      if (profile.entry.tags !== undefined) {
        definition(Array.isArray(profile.entry.tags), `${entryPath}.tags`, 'expected-array');
        for (const [tagIndex, tag] of profile.entry.tags.entries()) nonempty(tag, `${entryPath}.tags[${tagIndex}]`);
      }
      if (profile.entry.examples !== undefined) {
        definition(Array.isArray(profile.entry.examples), `${entryPath}.examples`, 'expected-array');
        for (const [exampleIndex, example] of profile.entry.examples.entries()) {
          const examplePath = `${entryPath}.examples[${exampleIndex}]`;
          object(example, examplePath);
          nonempty(example.instruction, `${examplePath}.instruction`);
          nonempty(example.explanation, `${examplePath}.explanation`);
          definition(typeof example.valid === 'boolean', `${examplePath}.valid`, 'expected-boolean');
        }
      }
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
      nonempty(requirement.verification_status, `${reqPath}.verification_status`);
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
    for (const [evidenceIndex, evidence] of (profile.entry?.acceptance_artifacts ?? []).entries()) {
      const producer = application.plugins.find(plugin => plugin.id === evidence.producer_plugin_id);
      definition([profile.primary, ...profile.aspects].includes(evidence.producer_plugin_id)
        && producer?.produces?.some(output => output.type === evidence.type && output.version === evidence.version),
      `profiles[${index}].entry.acceptance_artifacts[${evidenceIndex}]`, 'expected-selected-producer-contract');
    }
  }
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
