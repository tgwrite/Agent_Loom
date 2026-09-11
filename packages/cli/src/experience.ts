import { describeEntry } from '../../container-core/src/agent.ts';
import { taskInspectionView } from '../../container-core/src/index.ts';
import type { ApplicationDefinition, ContainerFailure, TaskSnapshot } from '../../container-core/src/index.ts';

/** Read-only projection of canonical governance facts, never a new acceptance record. */
export function summarizeTask(snapshot: TaskSnapshot) {
  const view = taskInspectionView(snapshot);
  return {
    schema_version: 1, task: view.task.id, application: view.task.application_id,
    business_acceptance: 'not-evaluated' as const,
    sessions: [...view.sessions].sort((a, b) => a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id))
      .map(session => ({ id: session.id, profile: session.profile_id, started_at: session.started_at,
      finished_at: session.finished_at ?? null,
      ...(session.request ? { request_id: session.request.request_id, entry_id: session.request.entry_id } : {}),
      status: session.status, primary: session.primary_plugin_id, aspects: session.aspect_plugin_ids,
      failure: session.failure ?? null, aspect_failures: session.aspect_failures,
      consumed: session.consumed.map(record => ({ artifact_id: record.artifact_id,
        sha256: record.sha256, producer: record.producer })),
      outputs: session.produced.map(artifact => ({ id: artifact.id, type: artifact.type,
        version: artifact.version, verification: artifact.verification.status,
        producer: artifact.producer, native_provenance: artifact.native_provenance, payload_ref: artifact.payload_ref })),
    })),
    counts: { sessions: snapshot.sessions.length, artifacts: snapshot.artifacts.length,
      consumptions: snapshot.sessions.reduce((sum, session) => sum + session.consumed.length, 0),
      aspect_failures: view.sessions.reduce((sum, session) => sum + session.aspect_failures.length, 0) },
  };
}

export function printTaskSummary(summary: ReturnType<typeof summarizeTask>): void {
  console.log(`Task: ${summary.task}\nApplication: ${summary.application}\nBusiness acceptance: not evaluated by Loom`);
  for (const session of summary.sessions) {
    console.log(`\n${session.profile}: ${session.status} (${session.id})`);
    if (session.failure) console.log(`Failure: ${session.failure.code}: ${session.failure.message}`);
    for (const failure of session.aspect_failures)
      console.log(`Aspect failure: ${failure.plugin_id}: ${failure.failure.code} [${failure.context.map(fact => `${fact.name}=${fact.value}`).join(', ')}]`);
    for (const input of session.consumed) console.log(`Consumed: ${input.artifact_id} <- ${input.producer.session_id}`);
    for (const artifact of session.outputs) console.log(`Output: ${artifact.type}@${artifact.version} ${artifact.verification}`
      + ` by ${artifact.producer.plugin_id}: ${artifact.payload_ref.kind === 'file' ? artifact.payload_ref.path : '(inline)'}`);
  }
  console.log(`\nSessions: ${summary.counts.sessions}; Artifacts: ${summary.counts.artifacts}; Aspect failures: ${summary.counts.aspect_failures}`);
  console.log('Verification labels are adapter assertions. Session completion does not establish business acceptance.');
}

export function explainApplication(application: ApplicationDefinition, hostConfigured: boolean) {
  return { schema_version: 1, runtime: application.runtime, host_configured: hostConfigured,
    execution: 'explicit-session-start', native_loading: 'host-defined',
    profiles: application.profiles.map(profile => ({ id: profile.id, entry: describeEntry(application, profile.entry?.id ?? profile.id), workspace: profile.workspace ?? '.',
      primary: profile.primary ?? null, aspects: profile.aspects, requirements: profile.requirements,
      plugins: [profile.primary, ...profile.aspects].filter((id): id is string => id !== undefined).map(id => {
        const plugin = application.plugins.find(plugin => plugin.id === id)!;
        return { id: plugin.id, role: plugin.role, binding_key: plugin.native.binding_key,
          produces: plugin.produces ?? [] };
      }) })),
  };
}

/** Diagnostics come from known control flow, never native messages or a model-generated command. */
export function diagnose(failure: ContainerFailure, command: string, phase: string) {
  const checks: Partial<Record<ContainerFailure['code'], readonly string[]>> = {
    InvalidArguments: ['Read loom --help and check command arguments.'],
    InvalidDefinition: ['Check Application exports, Plugin roles, binding keys and Profile requirements.'],
    NativeIntegrationNotReady: ['Check the local Host exports, SDK version and explicit Plugin entries.',
      'Application preflight does not verify model execution or business acceptance.'],
    PreconditionNotSatisfied: ['Inspect the Task and its required Artifact types, versions and verification labels.',
      'Choose the next Profile explicitly; dependency resolution never starts a producer.'],
    BindingConflict: ['Inspect all candidates and select an explicit identity; do not silently choose the newest Artifact.'],
    NativeExecutionFailed: ['Inspect the Session failure, aspect failures and native rejection events.',
      'Starting again creates a new Session and may repeat external effects.'],
    InvalidRecord: ['Check input validation, Task membership, selected references and Artifact digests.'],
    StorageFailure: ['Check local storage and inspect the explicit Task root before retrying.',
      'A partial write may remain; do not assume automatic crash recovery.'],
    TaskNotFound: ['Supply the original Task root with --root; Task identity is still checked.'],
    LegacyStoreDetected: ['Use explicit migration; do not create a second governance directory.'],
    InvalidTransition: ['Inspect the existing Session; terminal Sessions cannot be reopened.'],
  };
  return { schema_version: 1, command, phase, suggested_checks: checks[failure.code] ?? [],
    model_activity: phase === 'session-execution' || phase === 'host-loading' || phase === 'host-preflight'
      ? 'unknown' : 'not-started-by-cli' };
}
