import assert from 'node:assert/strict';
import test from 'node:test';
import { toArtifactRef } from '../../packages/container-core/src/artifact/index.ts';
import type { ArtifactProducerPhase, ArtifactNativeProvenance } from '../../packages/container-core/src/artifact/index.ts';
import { artifact, fixture, session, requirement } from '../helpers.ts';

// Guard the public type contract as well as runtime validation: inference must not widen it.
type Assert<T extends true> = T;
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
export type PhaseContract = Assert<Same<ArtifactProducerPhase, 'domain-run' | 'aspect-after-run'>>;
export type ProvenanceContract = Assert<Same<ArtifactNativeProvenance, {
  producer_phase?: 'domain-run' | 'aspect-after-run'; native_runtime_session_id?: string;
}>>;

test('Artifact references remain detached and exclude persisted extensions on publication and reopening', async t => {
  const { store, root } = await fixture(t);
  await store.startSession(session());
  const record = { ...artifact(), extension: { private_note: 'synthetic-extra' } };
  const reference = await store.publishArtifact(record);
  assert(!Object.hasOwn(reference, 'created_at'));
  assert(!Object.hasOwn(reference, 'extension'));
  assert(!Object.hasOwn(reference, 'producer_phase'));
  reference.producer.plugin_id = 'changed';
  reference.verification.status = 'changed';
  const { LocalTaskStore } = await import('../../packages/container-core/src/storage/index.ts');
  const reopened = await LocalTaskStore.open(root);
  assert.deepEqual(await reopened.resolveArtifact(requirement), toArtifactRef(record));
  const native = { ...record, producer_phase: 'domain-run' as const, native_runtime_session_id: 'native-producer' };
  const projected = toArtifactRef(native);
  assert.equal(projected.producer_phase, 'domain-run');
  assert.equal(projected.native_runtime_session_id, 'native-producer');
  projected.payload_ref = { kind: 'inline', value: null };
  assert.equal(native.payload_ref.kind, 'file');
});
