import { access, appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ArtifactRecord, ArtifactRef, ArtifactRequirement, ArtifactConsumptionRecord } from '../artifact/index.ts';
import { readNativeProvenance, toArtifactRef } from '../artifact/index.ts';
import { resolveProfile } from '../application/index.ts';
import { invocationRequirements } from '../invocation.ts';
import type { CoreEventType, EventEnvelope } from '../event/index.ts';
import { ContainerFailure } from '../failure/index.ts';
import { createObserverFailure } from '../failure/observer.ts';
import type { FailureRecord, ObserverFailureContext } from '../failure/index.ts';
import type { JsonValue } from '../json.ts';
import type { SessionRunRecord } from '../session/index.ts';
import type { TaskRecord } from '../task/index.ts';
import { identifier, requireRecord, validateArtifact, validateConsumption, validateEvent, validateFailure, validateSession, validateTask } from './validation.ts';

export const GOVERNANCE_DIRECTORY = '.agent-loom';

async function checkLegacy(taskRoot: string): Promise<void> {
  try {
    await access(join(resolve(taskRoot), '.agent-container'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new ContainerFailure('LegacyStoreDetected', 'Legacy governance data requires explicit migration before using this Task.');
}

async function io<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ContainerFailure) throw error;
    // Do not expose absolute filesystem paths or native error contents.
    throw new ContainerFailure('StorageFailure', 'Unable to read or persist governance records.');
  }
}

function parse<T>(content: string, validate: (value: T) => void): T {
  try {
    const value = JSON.parse(content) as T;
    validate(value);
    return value;
  } catch {
    throw new ContainerFailure('StorageFailure', 'Governance record is malformed or unsupported.');
  }
}

async function replaceJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Single writer per Task. This store performs governance checks, not domain verification. */
export class LocalTaskStore {
  readonly #root: string;
  readonly #task: TaskRecord;

  private constructor(taskRoot: string, task: TaskRecord) {
    this.#root = join(resolve(taskRoot), GOVERNANCE_DIRECTORY);
    this.#task = structuredClone(task);
  }

  get task(): TaskRecord {
    return structuredClone(this.#task);
  }

  get taskRoot(): string {
    return dirname(this.#root);
  }

  static async create(taskRoot: string, task: TaskRecord): Promise<LocalTaskStore> {
    task = structuredClone(task);
    validateTask(task);
    const store = new LocalTaskStore(taskRoot, task);
    return io(async () => {
      await checkLegacy(taskRoot);
      await mkdir(resolve(taskRoot), { recursive: true });
      // Exclusive creation prevents overwriting an existing Task.
      await mkdir(store.#root);
      await mkdir(join(store.#root, 'sessions'));
      await mkdir(join(store.#root, 'invocations'));
      await writeFile(join(store.#root, 'artifacts.jsonl'), '', { flag: 'wx' });
      await writeFile(join(store.#root, 'consumptions.jsonl'), '', { flag: 'wx' });
      await writeFile(join(store.#root, 'task.json'), `${JSON.stringify(task)}\n`, { flag: 'wx' });
      return store;
    });
  }

  static async open(taskRoot: string): Promise<LocalTaskStore> {
    return io(async () => {
      await checkLegacy(taskRoot);
      const task = parse(await readFile(join(resolve(taskRoot), GOVERNANCE_DIRECTORY, 'task.json'), 'utf8'), validateTask);
      return new LocalTaskStore(taskRoot, task);
    });
  }

  async startSession(session: SessionRunRecord): Promise<void> {
    session = structuredClone(session);
    validateSession(session);
    this.#assertTask(session.task_id);
    requireRecord(session.status === 'running', 'A new Session must be running.');
    const { profile, plugins } = resolveProfile(this.#task.application, session.profile_id);
    requireRecord(JSON.stringify(session.plugin_ids) === JSON.stringify(plugins.map((plugin) => plugin.id))
      && session.primary_plugin_id === profile.primary
      && JSON.stringify(session.aspect_plugin_ids) === JSON.stringify(profile.aspects),
    'Session composition does not match its Task Application snapshot.');
    // Dependency resolution is a precondition, never proof of successful consumption.
    for (const requirement of invocationRequirements(profile, this.#task.id, session.request)) await this.resolveArtifact(requirement);
    await io(async () => {
      const directory = join(this.#root, 'sessions', session.id);
      await mkdir(directory);
      await writeFile(join(directory, 'session.json'), `${JSON.stringify(session)}\n`, { flag: 'wx' });
      await writeFile(join(directory, 'events.jsonl'), '', { flag: 'wx' });
      await this.#coreEvent(session, 'session.started', session.started_at, {});
    });
  }

  async getSession(sessionId: string): Promise<SessionRunRecord> {
    identifier(sessionId);
    return io(async () => {
      const value = parse(await readFile(join(this.#root, 'sessions', sessionId, 'session.json'), 'utf8'), validateSession);
      this.#assertTask(value.task_id);
      requireRecord(value.id === sessionId, 'Session identity does not match its index.');
      return value;
    });
  }

  async listSessions(): Promise<SessionRunRecord[]> {
    return io(async () => {
      const entries = await readdir(join(this.#root, 'sessions'), { withFileTypes: true });
      return Promise.all(entries.filter((entry) => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name)).map((entry) => this.getSession(entry.name)));
    });
  }

  async settleSession(sessionId: string, status: 'completed' | 'failed', finishedAt: string, failure?: FailureRecord): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session.status !== 'running') {
      throw new ContainerFailure('InvalidTransition', 'Session has already settled.');
    }
    requireRecord(status === 'completed' || status === 'failed', 'Invalid settlement status.');
    const settled = { ...session, status, finished_at: finishedAt,
      ...(failure ? { failure } : status === 'failed' ? { failure: {
        code: 'SessionFailed', message: 'Runtime reported a failed Session.', source: 'runtime', timestamp: finishedAt,
      } } : {}) };
    validateSession(settled);
    await io(async () => {
      await this.#coreEvent(settled, `session.${status}`, finishedAt, settled.failure ? { failure: { ...settled.failure } } : {});
      // Publish the terminal state only after its required event is durable.
      // This is single-writer ordering, not a cross-file crash transaction.
      await replaceJson(join(this.#root, 'sessions', sessionId, 'session.json'), settled);
    });
  }

  async appendEvent(event: EventEnvelope): Promise<void> {
    validateEvent(event);
    this.#assertTask(event.task_id);
    const session = await this.getSession(event.session_id);
    requireRecord(event.actor_id === session.actor.id, 'Event Actor does not match its Session.');
    // Lifecycle/artifact facts are emitted only by their corresponding store mutations.
    requireRecord(!event.type.startsWith('session.') && !event.type.startsWith('artifact.') && event.type !== 'observer.failed',
      'Core lifecycle and publication Events are managed by the store.');
    requireRecord(session.status === 'running', 'Cannot append observations to a settled Session.');
    const events = await this.listEvents(event.session_id);
    if (events.some((value) => value.id === event.id)) {
      throw new ContainerFailure('BindingConflict', 'Event identity is already registered.');
    }
    await io(() => appendFile(join(this.#root, 'sessions', event.session_id, 'events.jsonl'), `${JSON.stringify(event)}\n`));
  }

  async listEvents(sessionId: string): Promise<EventEnvelope[]> {
    const session = await this.getSession(sessionId);
    const events = await this.#lines(join('sessions', sessionId, 'events.jsonl'), validateEvent);
    for (const event of events) {
      this.#assertTask(event.task_id);
      requireRecord(event.session_id === sessionId && event.actor_id === session.actor.id,
        'Event provenance does not match its Session.');
    }
    return events;
  }

  async publishArtifact(artifact: ArtifactRecord): Promise<ArtifactRef> {
    artifact = structuredClone(artifact);
    validateArtifact(artifact);
    this.#assertTask(artifact.task_id);
    const session = await this.getSession(artifact.producer.session_id);
    requireRecord(session.status === 'running', 'Artifact producer Session must be running.');
    this.#assertProvenance(artifact, session);
    if ((await this.listArtifacts()).some((value) => value.id === artifact.id)) {
      throw new ContainerFailure('BindingConflict', 'Artifact identity is already registered.');
    }
    await io(async () => {
      await appendFile(join(this.#root, 'artifacts.jsonl'), `${JSON.stringify(artifact)}\n`);
      await this.#coreEvent(session, 'artifact.published', artifact.created_at, { artifact_id: artifact.id });
    });
    return toArtifactRef(artifact);
  }

  async listArtifacts(): Promise<ArtifactRecord[]> {
    const artifacts = await this.#lines('artifacts.jsonl', validateArtifact);
    const ids = new Set<string>();
    for (const artifact of artifacts) {
      this.#assertTask(artifact.task_id);
      requireRecord(!ids.has(artifact.id), 'Duplicate Artifact identity in registry.');
      ids.add(artifact.id);
      this.#assertProvenance(artifact, await this.getSession(artifact.producer.session_id));
    }
    return artifacts;
  }

  async resolveArtifact(requirement: ArtifactRequirement): Promise<ArtifactRef> {
    const matches = (await this.listArtifacts()).filter((artifact) =>
      artifact.type === requirement.type && artifact.version === requirement.version
      && artifact.verification.status === requirement.verification_status
      && (requirement.artifact_id === undefined || artifact.id === requirement.artifact_id));
    const match = matches[0];
    if (!match) throw new ContainerFailure('PreconditionNotSatisfied', 'No Artifact satisfies this Task requirement.', {
      missing: [{ ...requirement }],
    });
    if (matches.length > 1) throw new ContainerFailure('BindingConflict', 'Multiple Artifacts satisfy this Task requirement.', {
      candidates: matches.map((artifact) => artifact.id),
    });
    return toArtifactRef(match);
  }

  async getArtifact(artifactId: string): Promise<ArtifactRecord> {
    identifier(artifactId);
    const artifact = (await this.listArtifacts()).find((value) => value.id === artifactId);
    if (!artifact) throw new ContainerFailure('PreconditionNotSatisfied', 'Artifact is not registered in this Task.');
    return artifact;
  }

  /** Call only after the consumer's own initializer has accepted this exact Artifact. */
  async recordConsumption(consumption: ArtifactConsumptionRecord): Promise<ArtifactConsumptionRecord> {
    consumption = structuredClone(consumption);
    validateConsumption(consumption);
    this.#assertTask(consumption.task_id);
    const session = await this.getSession(consumption.session_id);
    requireRecord(session.status === 'running', 'Consumption requires a running consumer Session.');
    requireRecord(session.plugin_ids.includes(consumption.consumer_plugin_id), 'Consumer Plugin is absent from Session.');
    const artifact = await this.getArtifact(consumption.artifact_id);
    requireRecord(artifact.sha256 === consumption.sha256, 'Consumed digest does not match the registered Artifact.');
    const records = await this.listConsumptions();
    const existing = records.find((record) => record.session_id === consumption.session_id
      && record.consumer_plugin_id === consumption.consumer_plugin_id && record.artifact_id === consumption.artifact_id);
    if (existing) return existing;
    if (records.some((record) => record.id === consumption.id)) {
      throw new ContainerFailure('BindingConflict', 'Consumption identity is already registered.');
    }
    await io(async () => {
      await appendFile(join(this.#root, 'consumptions.jsonl'), `${JSON.stringify(consumption)}\n`);
      await this.#coreEvent(session, 'artifact.consumed', consumption.consumed_at, {
        artifact_id: consumption.artifact_id, consumer_plugin_id: consumption.consumer_plugin_id,
      });
    });
    return structuredClone(consumption);
  }

  async listConsumptions(): Promise<ArtifactConsumptionRecord[]> {
    const records = await this.#lines('consumptions.jsonl', validateConsumption);
    const artifacts = new Map((await this.listArtifacts()).map((artifact) => [artifact.id, artifact]));
    const ids = new Set<string>();
    const bindings = new Set<string>();
    for (const record of records) {
      this.#assertTask(record.task_id);
      const session = await this.getSession(record.session_id);
      const artifact = artifacts.get(record.artifact_id);
      const binding = JSON.stringify([record.session_id, record.consumer_plugin_id, record.artifact_id]);
      requireRecord(!ids.has(record.id) && !bindings.has(binding), 'Duplicate consumption in registry.');
      requireRecord(artifact && artifact.sha256 === record.sha256
        && session.plugin_ids.includes(record.consumer_plugin_id), 'Consumption provenance is invalid.');
      ids.add(record.id);
      bindings.add(binding);
    }
    return records;
  }

  async recordObserverFailure(sessionId: string, pluginId: string, failure: FailureRecord,
    context: ObserverFailureContext = { phase: 'unknown', failure_class: 'unspecified' }): Promise<void> {
    validateFailure(failure);
    const session = await this.getSession(sessionId);
    requireRecord(session.status === 'running' && session.aspect_plugin_ids.includes(pluginId),
      'Observer must be an aspect of a running Session.');
    await io(() => this.#coreEvent(session, 'observer.failed', failure.timestamp,
      createObserverFailure(pluginId, failure, context)));
  }

  #assertTask(taskId: string): void {
    requireRecord(taskId === this.#task.id, 'Record belongs to a different Task.');
  }

  #assertProvenance(artifact: ArtifactRecord, session: SessionRunRecord): void {
    requireRecord(session.plugin_ids.includes(artifact.producer.plugin_id), 'Producer Plugin is absent from Session.');
    const plugin = this.#task.application.plugins.find((value) => value.id === artifact.producer.plugin_id);
    requireRecord(plugin?.produces?.some((contract) => contract.type === artifact.type && contract.version === artifact.version),
      'Artifact Contract is not declared by its producer in this Task.');
    requireRecord(artifact.executor.actor_id === session.actor.id
      && artifact.executor.runtime_id === session.runtime.id, 'Artifact executor does not match its Session.');
    const provenance = readNativeProvenance(artifact);
    if (provenance) {
      requireRecord(provenance.native_runtime_session_id === session.runtime_session_id,
        'Native Artifact identity does not match its producer Session.');
      requireRecord(provenance.producer_phase === 'domain-run'
        ? artifact.producer.plugin_id === session.primary_plugin_id
        : session.aspect_plugin_ids.includes(artifact.producer.plugin_id), 'Artifact phase does not match its producer role.');
    }
  }

  async #lines<T>(file: string, validate: (value: T) => void): Promise<T[]> {
    return io(async () => {
      const content = await readFile(join(this.#root, file), 'utf8');
      if (content === '') return [];
      if (!content.endsWith('\n')) throw new ContainerFailure('StorageFailure', 'Governance log has an incomplete record.');
      return content.slice(0, -1).split('\n').map((line) => parse(line, validate));
    });
  }

  async #coreEvent(session: SessionRunRecord, type: CoreEventType, timestamp: string, payload: JsonValue): Promise<void> {
    const event: EventEnvelope = { id: randomUUID(), type, timestamp, task_id: this.#task.id,
      session_id: session.id, actor_id: session.actor.id, source: 'container-core',
      correlation_id: session.id, payload };
    validateEvent(event);
    await appendFile(join(this.#root, 'sessions', session.id, 'events.jsonl'), `${JSON.stringify(event)}\n`);
  }
}
