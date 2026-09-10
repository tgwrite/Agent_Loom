import { randomUUID } from 'node:crypto';
import { resolveProfile } from './application/index.ts';
import type { ArtifactRef, ArtifactConsumptionRecord } from './artifact/index.ts';
import type { ActorRef, RuntimeRef } from './actor/index.ts';
import { ContainerFailure } from './failure/index.ts';
import type { FailureRecord } from './failure/index.ts';
import type { SessionRunRecord } from './session/index.ts';
import { LocalTaskStore } from './storage/index.ts';
import { resolveTaskPath, taskRelativePath } from './paths.ts';

export interface SessionPlan {
  task_id: string;
  profile_id: string;
  workspace: string;
  primary_plugin_id?: string;
  aspect_plugin_ids: readonly string[];
  plugin_ids: readonly string[];
  artifacts: readonly ArtifactRef[];
}

/** Side-effect-free plan. It never creates a Session, records consumption, or schedules a Plugin. */
export async function prepareSession(store: LocalTaskStore, profileId: string, workspace?: string): Promise<SessionPlan> {
  const { profile, plugins } = resolveProfile(store.task.application, profileId);
  const selectedWorkspace = workspace ?? profile.workspace ?? '.';
  taskRelativePath(selectedWorkspace, true);
  if (/^\.agent-(?:loom|container)(?:\/|$)/i.test(selectedWorkspace)) {
    throw new ContainerFailure('InvalidRecord', 'Session Workspace cannot be the governance directory.');
  }
  const artifacts: ArtifactRef[] = [];
  if (profile.requirements.length && !profile.primary) {
    throw new ContainerFailure('InvalidDefinition', 'Artifact initialization needs an explicit primary consumer.');
  }
  for (const requirement of profile.requirements) artifacts.push(await store.resolveArtifact(requirement));
  return { task_id: store.task.id, profile_id: profile.id, workspace: selectedWorkspace,
    ...(profile.primary ? { primary_plugin_id: profile.primary } : {}),
    aspect_plugin_ids: [...profile.aspects], plugin_ids: plugins.map((plugin) => plugin.id), artifacts };
}

export interface NativeSessionHandle {
  runtime_session_id: string;
  /** Must initialize and domain-verify the resolved inputs before returning successfully. */
  initialize(artifacts: readonly ArtifactRef[]): Promise<void>;
  run(): Promise<{ status: 'completed' | 'failed'; failure?: FailureRecord }>;
  close(): Promise<void>;
}

export interface SessionHost {
  runtime: RuntimeRef;
  validate(plan: SessionPlan): Promise<void>;
  /** Opens the native session without starting domain execution; run() starts execution. */
  launch(plan: SessionPlan, workspace: string, binding: { session_id: string; task_root: string; actor: ActorRef }): Promise<NativeSessionHandle>;
}

async function nativeCall<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch {
    throw new ContainerFailure('NativeExecutionFailed', 'Native initialization or execution failed.');
  }
}

/** Drives only the user-selected Session. Native adapters retain initialization and domain trust. */
export async function executeSession(store: LocalTaskStore, plan: SessionPlan,
  host: SessionHost, actor: ActorRef): Promise<SessionRunRecord> {
  // Rebuild from the immutable Task snapshot rather than trusting a caller-supplied plan.
  const prepared = await prepareSession(store, plan.profile_id, plan.workspace);
  if (JSON.stringify(prepared) !== JSON.stringify(plan)) {
    throw new ContainerFailure('InvalidRecord', 'Session plan no longer matches the Task.');
  }
  if (host.runtime.name !== store.task.application.runtime.id || host.runtime.version !== store.task.application.runtime.version) {
    throw new ContainerFailure('NativeIntegrationNotReady', 'Runtime does not match the Task Application target.');
  }
  await nativeCall(() => host.validate(structuredClone(prepared)));
  const sessionId = randomUUID();
  const handle = await nativeCall(() => host.launch(structuredClone(prepared), resolveTaskPath(store.taskRoot, prepared.workspace),
    { session_id: sessionId, task_root: store.taskRoot, actor: structuredClone(actor) }));
  const session: SessionRunRecord = { id: sessionId, task_id: prepared.task_id,
    profile_id: prepared.profile_id, workspace: prepared.workspace,
    ...(prepared.primary_plugin_id ? { primary_plugin_id: prepared.primary_plugin_id } : {}),
    aspect_plugin_ids: prepared.aspect_plugin_ids, plugin_ids: prepared.plugin_ids,
    actor: structuredClone(actor), runtime: structuredClone(host.runtime), runtime_session_id: handle.runtime_session_id,
    status: 'running', started_at: new Date().toISOString() };
  let recorded = false;
  let closed = false;
  try {
    await store.startSession(session);
    recorded = true;
    await nativeCall(() => handle.initialize(structuredClone(prepared.artifacts)));
    for (const artifact of prepared.artifacts) {
      if (!prepared.primary_plugin_id) throw new ContainerFailure('InvalidDefinition', 'Artifact initialization needs a primary consumer.');
      const consumption: ArtifactConsumptionRecord = { id: randomUUID(), task_id: prepared.task_id,
        session_id: session.id, consumer_plugin_id: prepared.primary_plugin_id,
        artifact_id: artifact.id, sha256: artifact.sha256, consumed_at: new Date().toISOString() };
      await store.recordConsumption(consumption);
    }
    const result = await nativeCall(() => handle.run());
    closed = true;
    await nativeCall(() => handle.close());
    await store.settleSession(session.id, result.status, new Date().toISOString(), result.failure);
    return await store.getSession(session.id);
  } catch (error) {
    // Give the Bridge a chance to flush shutdown observations before terminal settlement.
    if (!closed) {
      closed = true;
      try { await handle.close(); } catch { /* preserve the primary failure */ }
    }
    if (recorded && (await store.getSession(session.id)).status === 'running') {
      await store.settleSession(session.id, 'failed', new Date().toISOString(), {
        code: 'NativeExecutionFailed', message: 'Native initialization or execution failed.',
        source: 'native-adapter', timestamp: new Date().toISOString(),
      });
    }
    // Native error text may include private paths, credentials, or domain context.
    if (error instanceof ContainerFailure) throw error;
    throw new ContainerFailure('NativeExecutionFailed', 'Native initialization or execution failed.');
  } finally {
    // Preserve the primary failure if cleanup also fails; native text is never propagated.
    if (!closed) {
      try { await handle.close(); } catch { /* primary failure already recorded */ }
    }
  }
}

// Preserve the existing Core import path.
export { inspectTask } from './inspection.ts';
