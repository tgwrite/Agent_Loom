import type { ArtifactRequirement } from './artifact/index.ts';
import type { SessionProfile } from './session/index.ts';
import type { JsonValue } from './json.ts';
import { ContainerFailure } from './failure/index.ts';
import { identifier, jsonValue, requireRecord } from './record-validation.ts';
import { validateData } from './data-schema.ts';
import type { DataSchema } from './data-schema.ts';
export type { DataSchema } from './data-schema.ts';

/** Profile metadata, never a second execution registry. */
export interface EntryContract {
  id: string;
  purpose: string;
  name?: string;
  tags?: readonly string[];
  implementation: 'native' | 'synthetic';
  request_mapping?: 'v1';
  data_schema?: DataSchema;
  data_required?: boolean;
  data_examples?: readonly JsonValue[];
  /** App-selected evidence references; Core does not interpret their business verdicts. */
  acceptance_artifacts?: readonly { type: string; version: string; producer_plugin_id: string }[];
  effect_declarations: readonly string[];
  examples?: readonly { instruction: string; valid: boolean; explanation: string }[];
}

export interface AgentRequest {
  schema_version: 1;
  request_id: string;
  task_id: string;
  entry_id: string;
  instruction?: string;
  data?: JsonValue;
  inputs?: Readonly<Record<string, { artifact_id: string }>>;
}

const requestProperties = {
  schema_version: { const: 1 }, request_id: { type: 'string' }, task_id: { type: 'string' },
  entry_id: { type: 'string' }, instruction: { type: 'string' }, data: {},
  inputs: { type: 'object', additionalProperties: { type: 'object', required: ['artifact_id'],
    additionalProperties: false, properties: { artifact_id: { type: 'string' } } } },
};

/** JSON Schema describes JSON shape; runtime identity and domain checks remain explicit. */
export function requestSchema(profile: SessionProfile) {
  return structuredClone({ type: 'object', additionalProperties: false,
    required: ['schema_version', 'request_id', 'task_id', 'entry_id', ...(profile.entry?.data_required ? ['data'] : [])],
    properties: { ...requestProperties, entry_id: { const: profile.entry?.id ?? profile.id },
      instruction: profile.entry?.request_mapping === 'v1' ? requestProperties.instruction : false,
      data: profile.entry?.request_mapping === 'v1' ? profile.entry.data_schema ?? requestProperties.data : false,
      inputs: { type: 'object', additionalProperties: false,
        properties: Object.fromEntries(profile.requirements.filter(r => r.input_name).map(r => [r.input_name!, {
          ...requestProperties.inputs.additionalProperties,
          properties: { artifact_id: r.artifact_id ? { const: r.artifact_id } : { type: 'string' } },
        }])) },
    },
  });
}

export function validateRequest(value: unknown): asserts value is AgentRequest {
  jsonValue(value);
  requireRecord(typeof value === 'object' && value !== null && !Array.isArray(value), 'Request must be an object.');
  const request = value as Record<string, unknown>;
  requireRecord(Object.keys(request).every(key => Object.hasOwn(requestProperties, key)), 'Unknown request field.');
  requireRecord(request.schema_version === 1, 'Unsupported request version.');
  identifier(request.request_id as string);
  identifier(request.task_id as string);
  requireRecord(typeof request.entry_id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(request.entry_id), 'Invalid entry identity.');
  if (request.instruction !== undefined) requireRecord(typeof request.instruction === 'string', 'Instruction must be text.');
  if (request.inputs !== undefined) {
    requireRecord(typeof request.inputs === 'object' && request.inputs !== null && !Array.isArray(request.inputs), 'Inputs must be named references.');
    for (const [name, ref] of Object.entries(request.inputs)) {
      identifier(name);
      requireRecord(typeof ref === 'object' && ref !== null && Object.keys(ref).length === 1 && 'artifact_id' in ref, 'Input must contain only an Artifact identity.');
      identifier((ref as { artifact_id: string }).artifact_id);
    }
  }
}

/** Shared by preparation, execution revalidation and the Store startup gate. */
export function invocationRequirements(profile: SessionProfile, taskId: string, request?: AgentRequest): readonly ArtifactRequirement[] {
  if (profile.entry?.data_required && request?.data === undefined)
    throw new ContainerFailure('InvalidArguments', 'Required request data is missing.', { path: 'data', rule: 'required' });
  if (!request) return profile.requirements;
  validateRequest(request);
  requireRecord(request.task_id === taskId && request.entry_id === (profile.entry?.id ?? profile.id), 'Request does not match this Task and entry.');
  if ((request.instruction !== undefined || request.data !== undefined) && profile.entry?.request_mapping !== 'v1')
    throw new ContainerFailure('InvalidArguments', 'Entry does not support invocation data mapping.');
  if (profile.entry?.data_schema !== undefined && request.data !== undefined) validateData(profile.entry.data_schema, request.data);
  const inputs = request.inputs ?? {};
  requireRecord(Object.keys(inputs).every(name => profile.requirements.some(r => r.input_name === name)), 'Unknown named input.');
  return profile.requirements.map(requirement => {
    const selected = requirement.input_name && Object.hasOwn(inputs, requirement.input_name) ? inputs[requirement.input_name] : undefined;
    if (!selected) return requirement;
    requireRecord(requirement.artifact_id === undefined || requirement.artifact_id === selected.artifact_id, 'Input cannot override a pinned Artifact.');
    return { ...requirement, artifact_id: selected.artifact_id };
  });
}
