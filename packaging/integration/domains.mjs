// Domain-owned examples. Their structures intentionally differ.
import assert from 'node:assert/strict';

export const domains = {
  measurement: {
    contract: { type: 'measurement.samples', version: '1' },
    parse(value) {
      assert(value?.unit === 'm' && Array.isArray(value.samples) && value.samples.length > 0);
      assert(value.samples.every(Number.isFinite));
      return value;
    },
    consume(value) { return { total: value.samples.reduce((sum, number) => sum + number, 0), unit: value.unit }; },
  },
  catalog: {
    contract: { type: 'catalog.entries', version: '1' },
    parse(value) {
      assert(Array.isArray(value?.entries) && value.entries.length > 0);
      assert(value.entries.every(entry => typeof entry.key === 'string' && entry.key.trim()));
      assert.equal(new Set(value.entries.map(entry => entry.key)).size, value.entries.length);
      return value;
    },
    consume(value) { return { keys: value.entries.map(entry => entry.key).sort() }; },
  },
};

export function definition(id) {
  const contract = domains[id].contract;
  return { id, version: '1', runtime: { id: 'pi', version: 'synthetic' },
    plugins: [{ id: 'domain', role: 'domain', native: { runtime: 'pi', binding_key: 'domain' },
      capabilities: [], produces: [contract, { type: `${id}.result`, version: '1' }] }],
    profiles: [{ id: 'produce', primary: 'domain', aspects: [], workspace: 'producer', requirements: [],
        entry: { id: `${id}.produce`, purpose: 'Accept a synthetic source snapshot', implementation: 'synthetic', request_mapping: 'v1', effect_declarations: ['task-files-write'] } },
      { id: 'consume', primary: 'domain', aspects: [], workspace: 'consumer', requirements: [{ ...contract, verification_status: 'READY', input_name: 'source' }],
        entry: { id: `${id}.consume`, purpose: 'Derive a synthetic result from an accepted source', implementation: 'synthetic', request_mapping: 'v1', effect_declarations: ['task-files-write'] } }],
  };
}
