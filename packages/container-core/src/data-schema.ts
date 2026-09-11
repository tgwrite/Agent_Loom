import { ContainerFailure } from './failure/index.ts';
import { jsonValue } from './record-validation.ts';
import type { JsonValue } from './json.ts';

/** Deliberately bounded JSON Schema subset; unsupported keywords are rejected. */
export type DataSchema = boolean | {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  description?: string;
  properties?: Readonly<Record<string, DataSchema>>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: DataSchema;
  minItems?: number; maxItems?: number;
  minLength?: number; maxLength?: number;
  minimum?: number; maximum?: number;
  enum?: readonly JsonValue[];
  const?: JsonValue;
};

const keywords = new Set(['type', 'description', 'properties', 'required', 'additionalProperties', 'items',
  'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'enum', 'const']);
const propertyName = /^[a-zA-Z_][a-zA-Z0-9_-]{0,127}$/;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// JSON numbers have no distinct negative-zero value; property order is immaterial.
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((item, index) => equal(item, right[index]));
  if (object(left) && object(right)) return Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
  return false;
}

export function validateDataSchema(value: unknown, path: string): asserts value is DataSchema {
  let nodes = 0;
  const check = (ok: unknown, location: string, rule: string): void => {
    if (!ok) throw new ContainerFailure('InvalidDefinition', 'Invalid data Schema declaration.', { path: location, rule });
  };
  const visit = (schema: unknown, location: string, depth: number): void => {
    check(++nodes <= 1024 && depth <= 32, location, 'schema-complexity-limit');
    if (typeof schema === 'boolean') return;
    check(object(schema) && Object.getPrototypeOf(schema) === Object.prototype, location, 'expected-schema');
    const s = schema as Record<string, unknown>;
    check(Object.keys(s).every(key => keywords.has(key)), location, 'unsupported-schema-keyword');
    if (s.type !== undefined) check(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(s.type as string), `${location}.type`, 'unsupported-type');
    if (s.description !== undefined) check(typeof s.description === 'string', `${location}.description`, 'expected-string');
    if (s.properties !== undefined) {
      check(object(s.properties) && Object.getPrototypeOf(s.properties) === Object.prototype, `${location}.properties`, 'expected-object');
      for (const [name, child] of Object.entries(s.properties as object)) {
        check(propertyName.test(name), `${location}.properties`, 'unsupported-property-name');
        visit(child, `${location}.properties.${name}`, depth + 1);
      }
    }
    if (s.required !== undefined) check(Array.isArray(s.required)
      && s.required.every(name => typeof name === 'string' && propertyName.test(name))
      && new Set(s.required).size === s.required.length, `${location}.required`, 'expected-unique-property-names');
    if (s.additionalProperties !== undefined) check(typeof s.additionalProperties === 'boolean', `${location}.additionalProperties`, 'expected-boolean');
    if (s.items !== undefined) visit(s.items, `${location}.items`, depth + 1);
    for (const key of ['minItems', 'maxItems', 'minLength', 'maxLength']) if (s[key] !== undefined)
      check(Number.isSafeInteger(s[key]) && (s[key] as number) >= 0, `${location}.${key}`, 'expected-nonnegative-integer');
    for (const key of ['minimum', 'maximum']) if (s[key] !== undefined)
      check(typeof s[key] === 'number' && Number.isFinite(s[key]), `${location}.${key}`, 'expected-finite-number');
    for (const key of ['enum', 'const']) if (Object.hasOwn(s, key)) {
      try { jsonValue(s[key]); } catch { check(false, `${location}.${key}`, 'expected-json'); }
    }
    if (s.enum !== undefined) {
      check(Array.isArray(s.enum) && s.enum.length > 0 && s.enum.length <= 256, `${location}.enum`, 'expected-bounded-nonempty-array');
      check((s.enum as unknown[]).every((item, index, values) => !values.slice(0, index).some(other => equal(item, other))), `${location}.enum`, 'duplicate-enum-value');
    }
  };
  visit(value, path, 0);
}

/** Never returns request values or unknown property names in diagnostics. */
export function validateData(schema: DataSchema, value: JsonValue, path = 'data'): void {
  const check = (ok: unknown, rule: string): void => {
    if (!ok) throw new ContainerFailure('InvalidArguments', 'Request data does not match its entry Schema.', { path, rule });
  };
  if (typeof schema === 'boolean') { check(schema, 'false-schema'); return; }
  if (schema.type) check(schema.type === 'null' ? value === null
    : schema.type === 'array' ? Array.isArray(value)
    : schema.type === 'object' ? object(value)
    : schema.type === 'integer' ? typeof value === 'number' && Number.isInteger(value)
    : typeof value === schema.type, 'type');
  if (Object.hasOwn(schema, 'const')) check(equal(value, schema.const), 'const');
  if (schema.enum) check(schema.enum.some(item => equal(value, item)), 'enum');
  if (object(value)) {
    for (const name of schema.required ?? []) if (!Object.hasOwn(value, name))
      throw new ContainerFailure('InvalidArguments', 'Required request data is missing.', { path: `${path}.${name}`, rule: 'required' });
    for (const [name, item] of Object.entries(value)) {
      if (schema.properties && Object.hasOwn(schema.properties, name)) validateData(schema.properties[name]!, item as JsonValue, `${path}.${name}`);
      else check(schema.additionalProperties !== false, 'additionalProperties');
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined) check(value.length >= schema.minItems, 'minItems');
    if (schema.maxItems !== undefined) check(value.length <= schema.maxItems, 'maxItems');
    if (schema.items !== undefined) value.forEach((item, index) => validateData(schema.items!, item, `${path}[${index}]`));
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined) check(length >= schema.minLength, 'minLength');
    if (schema.maxLength !== undefined) check(length <= schema.maxLength, 'maxLength');
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined) check(value >= schema.minimum, 'minimum');
    if (schema.maximum !== undefined) check(value <= schema.maximum, 'maximum');
  }
}
