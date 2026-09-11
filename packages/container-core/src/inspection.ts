import type { LocalTaskStore } from './storage/index.ts';
import { readNativeProvenance } from './artifact/index.ts';
import { readObserverFailure } from './failure/observer.ts';
import { invocationRequirements } from './invocation.ts';
import { requireRecord } from './record-validation.ts';

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const id = key(value);
    const group = groups.get(id) ?? [];
    group.push(value);
    groups.set(id, group);
  }
  return groups;
}

/** The existing JSON snapshot contract, including original historical records. */
export async function inspectTask(store: LocalTaskStore) {
  const task = store.task;
  const profiles = new Map(task.application.profiles.map(profile => [profile.id, profile]));
  const { artifacts, consumptions, sessions, events } = await store.readInspectionRecords();
  const producedBySession = groupBy(artifacts, artifact => artifact.producer.session_id);
  const consumedBySession = groupBy(consumptions, consumption => consumption.session_id);
  const consumedByArtifact = groupBy(consumptions, consumption => consumption.artifact_id);
  const byId = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  return {
    task,
    sessions: sessions.map(session => {
      if (session.resolved_inputs) {
        const profile = profiles.get(session.profile_id);
        requireRecord(profile !== undefined, 'Input binding Profile is unavailable.');
        const requirements = invocationRequirements(profile!, session.task_id, session.request);
        requireRecord(session.resolved_inputs.bindings.length === requirements.length, 'Input binding count does not match.');
        for (const [index, binding] of session.resolved_inputs.bindings.entries()) {
          const requirement = requirements[index]!;
          const artifact = byId.get(binding.artifact_id);
          requireRecord(binding.input_name === requirement.input_name && artifact !== undefined
            && binding.sha256 === artifact.sha256 && artifact.type === requirement.type && artifact.version === requirement.version
            && artifact.verification.status === requirement.verification_status
            && (requirement.artifact_id === undefined || requirement.artifact_id === artifact.id),
          'Recorded input binding does not match its Task facts.');
        }
      }
      const produced = producedBySession.get(session.id) ?? [];
      return {
        ...session,
        acceptance_artifact_contracts: profiles.get(session.profile_id)?.entry?.acceptance_artifacts ?? [],
        produced,
        consumed: (consumedBySession.get(session.id) ?? []).map(record => ({
          ...record, producer: byId.get(record.artifact_id)!.producer,
        })),
        events: events.get(session.id)!,
        plugin_artifact_counts: Object.fromEntries(session.plugin_ids.map(pluginId => {
          const counts = new Map<string, number>();
          for (const artifact of produced) if (artifact.producer.plugin_id === pluginId)
            counts.set(artifact.type, (counts.get(artifact.type) ?? 0) + 1);
          return [pluginId, Object.fromEntries(counts)];
        })),
      };
    }),
    artifacts: artifacts.map((artifact) => ({ ...artifact,
      consumers: consumedByArtifact.get(artifact.id) ?? [] })),
  };
}

export type TaskSnapshot = Awaited<ReturnType<typeof inspectTask>>;

const details = (value: object | null) => Object.entries(value ?? {}).map(([name, value]) => ({ name, value: String(value) }));

/** Core owns version interpretation and relationships; renderers consume named facts. */
export function taskInspectionView(snapshot: TaskSnapshot) {
  return { task: snapshot.task, sessions: snapshot.sessions.map(session => ({
    ...session,
    produced: session.produced.map(artifact => ({ ...artifact, native_provenance: details(readNativeProvenance(artifact)) })),
    aspect_failures: session.events.filter(event => event.type === 'observer.failed').map(event => {
      const failure = readObserverFailure(event.payload);
      return { plugin_id: failure.plugin_id, failure: failure.failure,
        context: failure.context ? details(failure.context) : [{ name: 'contract', value: 'legacy' }] };
    }),
    event_types: session.events.map(event => event.type),
  })) };
}

export type TaskInspection = ReturnType<typeof taskInspectionView>;
