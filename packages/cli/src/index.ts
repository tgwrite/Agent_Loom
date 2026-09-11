import { connectLoom, discoverEntries, describeEntry } from '../../container-core/src/agent.ts';
import type { AgentRequest } from '../../container-core/src/invocation.ts';
import { validateRequest } from '../../container-core/src/invocation.ts';
import { hostReadinessFailure, safeHostReadinessFailure, nativeReadinessReport } from '../../container-core/src/index.ts';
import { dirname, resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ContainerFailure, LocalTaskStore, executeSession, inspectTask, taskInspectionView, prepareSession, resolveTaskPath, validateApplication } from '../../container-core/src/index.ts';
import type { ApplicationDefinition, SessionHost } from '../../container-core/src/index.ts';
import { requireNativeIntegration } from '../../runtime-pi/src/index.ts';
import { TaskCatalog } from './catalog.ts';
import { readHostBinding, saveHostBinding } from './host-binding.ts';
import { diagnose, explainApplication, printTaskSummary, summarizeTask } from './experience.ts';

const help = `Agent Loom (development preview)

loom agent discover [--app <application.ts> | --task <id> --root <directory>] [--id <entry>] [--name <text>] [--tag <tag>] [--input-type <type>] [--output-type <type>] [--json]
loom agent describe <entry> [--app <application.ts> | --task <id> --root <directory>] [--json]
loom agent check --task <id> --request <json-file> [--root <directory>] [--host-module <file>] [--native-preflight] [--json]
loom agent invoke --task <id> --request <json-file> [--root <directory>] [--host-module <file>] [--exclusive-writer] [--json]
loom agent inspect --task <id> [--root <directory>] [--entry <entry>] [--session <id>] [--request-id <id>] [--artifact <id>] [--json]

loom app validate <application.ts> [--definition-only | --host-module <file>] [--explain] [--json]
loom task create --app <application.ts> --root <directory> --name <id> [--input <json-file>] [--host-module <file>] [--json]
loom task inspect <id> [--root <directory>] [--summary] [--json]
loom session start --task <id> --profile <profile> [--root <directory>] [--workspace <relative>] [--dry-run | --host-module <file>] [--json]
loom session inspect <id> --task <task-id> [--root <directory>] [--json]
loom artifact inspect <id> --task <task-id> [--root <directory>] [--json]

An application module may export nativeHost (a path relative to that module).
Task creation saves this local binding; later Sessions need only Task and Profile.
A trusted --host-module overrides it and provides createSessionHost({ store }).
No built-in Plugin installation is performed. Local Task indexing uses LOOM_STATE_DIR
when set. Use --root to locate a Task without that index.
--input saves JSON in .agent-loom/input.json after optional validateTaskInput(value).
--summary projects governance facts; it does not certify business acceptance.
--explain describes composition and dependency gates without executing a Profile.
Agent integration guide: agent-loom/AGENT_GUIDE.md in the installed package.`;

function argumentsFor(args: string[], allowed: readonly string[]) {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) { positionals.push(arg); continue; }
    if (!allowed.includes(arg) || flags.has(arg)) throw new ContainerFailure('InvalidArguments', 'Unknown or duplicate option.');
    if (['--json', '--definition-only', '--dry-run', '--summary', '--explain', '--native-preflight', '--exclusive-writer'].includes(arg)) flags.set(arg, true);
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new ContainerFailure('InvalidArguments', 'Option requires a value.');
      flags.set(arg, value);
    }
  }
  return { flags, positionals,
    value: (name: string) => typeof flags.get(name) === 'string' ? flags.get(name) as string : undefined,
    required: (name: string) => {
      const value = flags.get(name);
      if (typeof value !== 'string') throw new ContainerFailure('InvalidArguments', 'Missing required option.', { option: name });
      return value;
    },
  };
}

async function loadApplication(file: string): Promise<{ application: ApplicationDefinition; nativeHost?: string;
  validateTaskInput?: (input: unknown) => unknown }> {
  let value: unknown;
  let nativeHost: string | undefined;
  let validateTaskInput: ((input: unknown) => unknown) | undefined;
  try {
    const module = await import(pathToFileURL(resolve(file)).href) as Record<string, unknown>;
    value = module.default ?? module.application;
    if (module.validateTaskInput !== undefined) {
      if (typeof module.validateTaskInput !== 'function') throw new Error();
      validateTaskInput = module.validateTaskInput as (input: unknown) => unknown;
    }
    if (module.nativeHost !== undefined) {
      if (typeof module.nativeHost !== 'string' || !module.nativeHost.trim()) throw new Error();
      nativeHost = resolve(dirname(resolve(file)), module.nativeHost);
    }
  } catch {
    throw new ContainerFailure('InvalidDefinition', 'Unable to load Application module. Export the definition as default or application.');
  }
  validateApplication(value);
  return { application: value, ...(nativeHost ? { nativeHost } : {}), ...(validateTaskInput ? { validateTaskInput } : {}) };
}

async function loadHost(file: string, store: LocalTaskStore): Promise<SessionHost> {
  let module: Record<string, unknown>;
  try { module = await import(pathToFileURL(resolve(file)).href) as Record<string, unknown>; }
  catch (error) { throw safeHostReadinessFailure(error, 'host-import'); }
  try {
    if (typeof module.createSessionHost !== 'function') throw hostReadinessFailure('host-contract');
    const host: SessionHost = await module.createSessionHost({ store });
    if (!host || typeof host.validate !== 'function' || typeof host.launch !== 'function'
      || !host.runtime || typeof host.runtime.id !== 'string' || typeof host.runtime.name !== 'string'
      || typeof host.runtime.version !== 'string') throw new Error();
    return host;
  } catch (error) {
    throw safeHostReadinessFailure(error, 'host-contract');
  }
}

async function validateNativeHost(file: string, application: ApplicationDefinition) {
  let module: Record<string, unknown>;
  try { module = await import(pathToFileURL(resolve(file)).href) as Record<string, unknown>; }
  catch (error) { throw safeHostReadinessFailure(error, 'host-import'); }
  try {
    if (typeof module.validateNativeApplication !== 'function') throw hostReadinessFailure('host-contract');
    const report = nativeReadinessReport(await module.validateNativeApplication({ application: structuredClone(application) }));
    if (Object.values(report).includes('failed')) throw hostReadinessFailure('host-contract');
    return report;
  } catch (error) {
    throw safeHostReadinessFailure(error, 'host-contract');
  }
}

function output(value: unknown, json: boolean): void {
  // JSON is also useful locally; the human renderer below emphasizes Task relationships.
  if (json || !value || typeof value !== 'object' || !('sessions' in value)) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  const snapshot = taskInspectionView(value as Awaited<ReturnType<typeof inspectTask>>);
  console.log(`Task: ${snapshot.task.id}\nApplication: ${snapshot.task.application_id}@${snapshot.task.application.version}`);
  for (const session of snapshot.sessions) {
    console.log(`\nSession: ${session.id}\nProfile: ${session.profile_id}\nWorkspace: ${session.workspace}`);
    console.log(`Runtime: ${session.runtime.name}@${session.runtime.version}\nActor: ${session.actor.id}\nStatus: ${session.status}`);
    console.log(`Primary: ${session.primary_plugin_id ?? '(none)'}\nAspects: ${session.aspect_plugin_ids.join(', ') || '(none)'}`);
    for (const artifact of session.produced) {
      console.log(`Produced: ${artifact.type}@${artifact.version} ${artifact.verification.status} (${artifact.id})`);
      if (artifact.native_provenance.length) console.log(`Native provenance: ${artifact.native_provenance.map(fact => fact.value).join(' ')}`);
    }
    for (const consumption of session.consumed) console.log(`Consumed: ${consumption.artifact_id} <- ${consumption.producer.session_id}`);
    for (const [plugin, counts] of Object.entries(session.plugin_artifact_counts)) {
      for (const [type, count] of Object.entries(counts)) console.log(`Artifacts: ${plugin} ${type} = ${count}`);
    }
    if (session.failure) console.log(`Failure: ${session.failure.code}: ${session.failure.message}`);
    for (const aspect of session.aspect_failures) {
      console.log(`Aspect failure: ${aspect.plugin_id}: ${aspect.failure.code}: ${aspect.failure.message}`
        + ` [${aspect.context.map(fact => fact.value).join('; ')}]`);
    }
    console.log(`Events: ${session.event_types.join(', ')}`);
  }
  if (!snapshot.sessions.length) console.log('Sessions: none');
}

export async function main(args: string[]): Promise<number> {
  let phase = 'arguments';
  const command = args.slice(0, 2).join(' ');
  let knownCommand = false;
  try {
    if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) {
      console.log(help);
      return 0;
    }
    const allowed: Record<string, string[]> = {
      'agent discover': ['--app', '--task', '--root', '--id', '--name', '--tag', '--input-type', '--output-type', '--json'],
      'agent describe': ['--app', '--task', '--root', '--json'],
      'agent check': ['--task', '--root', '--request', '--host-module', '--native-preflight', '--json'],
      'agent invoke': ['--task', '--root', '--request', '--host-module', '--exclusive-writer', '--json'],
      'agent inspect': ['--task', '--root', '--entry', '--session', '--request-id', '--artifact', '--json'],
      'app validate': ['--definition-only', '--host-module', '--explain', '--json'],
      'task create': ['--app', '--root', '--name', '--input', '--host-module', '--json'],
      'task inspect': ['--root', '--summary', '--json'],
      'session start': ['--task', '--profile', '--root', '--workspace', '--dry-run', '--host-module', '--json'],
      'session inspect': ['--task', '--root', '--json'],
      'artifact inspect': ['--task', '--root', '--json'],
    };
    if (!allowed[command]) throw new ContainerFailure('InvalidArguments', 'Unknown command. Use loom --help.');
    knownCommand = true;
    if (args.length === 3 && args[2] === '--help') { console.log(help); return 0; }
    const options = argumentsFor(args.slice(2), allowed[command]);
    const needsPositional = !['task create', 'session start', 'agent discover', 'agent check', 'agent invoke', 'agent inspect'].includes(command);
    if (options.positionals.length !== (needsPositional ? 1 : 0)) {
      throw new ContainerFailure('InvalidArguments', 'Incorrect number of positional arguments.');
    }
    const json = options.flags.has('--json');
    if (command === 'app validate') {
      phase = 'application-loading';
      const { application, nativeHost } = await loadApplication(options.positionals[0]!);
      const definitionOnly = options.flags.has('--definition-only');
      const hostModule = options.value('--host-module') ?? nativeHost;
      if (definitionOnly && options.value('--host-module')) throw new ContainerFailure('InvalidArguments', 'Choose either --definition-only or --host-module.');
      if (!definitionOnly) {
        phase = 'host-preflight';
        if (!hostModule) requireNativeIntegration();
        await validateNativeHost(hostModule, application);
      }
      output({ application: application.id, definition: 'valid', native_integration: definitionOnly ? 'not-verified' : 'host-preflight-passed',
        profiles: application.profiles.map((profile) => profile.id),
        ...(options.flags.has('--explain') ? { explanation: explainApplication(application, Boolean(hostModule)) } : {}) }, json);
      return 0;
    }
    const catalog = new TaskCatalog();
    if (command.startsWith('agent ')) {
      const filter = { ...(options.value('--id') ? { id: options.value('--id')! } : {}),
        ...(options.value('--name') ? { name: options.value('--name')! } : {}),
        ...(options.value('--tag') ? { tag: options.value('--tag')! } : {}),
        ...(options.value('--input-type') ? { input_type: options.value('--input-type')! } : {}),
        ...(options.value('--output-type') ? { output_type: options.value('--output-type')! } : {}) };
      const appFile = options.value('--app');
      if (appFile) {
        if (options.value('--task') || options.value('--root')) throw new ContainerFailure('InvalidArguments', 'Choose an Application or a Task.');
        phase = 'application-loading';
        const { application } = await loadApplication(appFile);
        output(command === 'agent discover' ? discoverEntries(application, filter) : describeEntry(application, options.positionals[0]!), true);
        return 0;
      }
      const taskId = options.required('--task');
      phase = 'task-loading';
      const store = await catalog.open(taskId, options.value('--root'));
      if (command === 'agent discover') { output(discoverEntries(store.task.application, filter), true); return 0; }
      if (command === 'agent describe') { output(describeEntry(store.task.application, options.positionals[0]!), true); return 0; }
      phase = 'host-loading';
      let selectedHost = options.value('--host-module');
      let invalidHost = false;
      if (!selectedHost) {
        try { selectedHost = await readHostBinding(store); }
        catch (error) {
          if (!(error instanceof ContainerFailure) || error.code !== 'NativeIntegrationNotReady') throw error;
          invalidHost = true;
        }
      }
      const hostPath = () => {
        if (!selectedHost) throw new ContainerFailure('NativeIntegrationNotReady', 'Host delivery is invalid.');
        return selectedHost;
      };
      phase = 'task-loading';
      const loom = await connectLoom({ taskRoot: store.taskRoot, taskId: store.task.id,
        ...(options.flags.has('--exclusive-writer') ? { writer_policy: 'exclusive' as const } : {}),
        ...(selectedHost || invalidHost ? { host: { actor: { id: 'local-operator' }, delivery: invalidHost ? 'invalid' as const : 'declared' as const,
          createHost: async ({ store: active }) => {
            phase = 'host-loading'; const host = await loadHost(hostPath(), active);
            phase = 'session-execution'; return host;
          },
          nativePreflight: async () => { phase = 'host-preflight'; return validateNativeHost(hostPath(), store.task.application); },
        } } : {}) });
      if (command === 'agent inspect') {
        phase = 'inspection';
        const facts = await loom.inspect({ ...(options.value('--entry') ? { entry_id: options.value('--entry')! } : {}),
          ...(options.value('--session') ? { session_id: options.value('--session')! } : {}),
          ...(options.value('--request-id') ? { request_id: options.value('--request-id')! } : {}),
          ...(options.value('--artifact') ? { artifact_id: options.value('--artifact')! } : {}) });
        output(facts, true); return facts.history === 'readable' ? 0 : 1;
      }
      phase = 'arguments';
      let request: AgentRequest;
      try { request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(resolve(options.required('--request'))))); }
      catch { throw new ContainerFailure('InvalidArguments', 'Request must be a readable UTF-8 JSON file.'); }
      validateRequest(request);
      if (command === 'agent check') {
        phase = 'dependency-resolution';
        const checked = await loom.check(request, { native_preflight: options.flags.has('--native-preflight') });
        output(checked, true); return checked.blockers.length ? 1 : 0;
      }
      phase = 'dependency-resolution';
      const result = await loom.invoke(request);
      output(result, true); return result.execution.status === 'completed' ? 0 : 1;
    }
    if (command === 'task create') {
      phase = 'application-loading';
      const { application, nativeHost, validateTaskInput } = await loadApplication(options.required('--app'));
      const id = options.required('--name');
      const root = options.required('--root');
      phase = 'task-input';
      const inputFile = options.value('--input');
      let input: unknown;
      if (inputFile !== undefined) {
        try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(resolve(inputFile)))); }
        catch { throw new ContainerFailure('InvalidArguments', 'Task input must be a readable UTF-8 JSON file.', { option: '--input' }); }
      }
      if (validateTaskInput) {
        try { await validateTaskInput(structuredClone(input)); }
        catch { throw new ContainerFailure('InvalidArguments', 'Application rejected Task input.', { check: 'validateTaskInput' }); }
      }
      phase = 'task-creation';
      await catalog.ensureAvailable(id);
      const store = await LocalTaskStore.create(root, { schema_version: 2, id,
        application_id: application.id, application, title: id, created_at: new Date().toISOString() });
      if (inputFile !== undefined) await writeFile(resolveTaskPath(store.taskRoot, '.agent-loom/input.json'),
        JSON.stringify(input) + '\n', { flag: 'wx', mode: 0o600 });
      const hostModule = options.value('--host-module') ?? nativeHost;
      if (hostModule) await saveHostBinding(store, resolve(hostModule));
      await catalog.register(store);
      output({ task: id, application: application.id, status: 'created', native_integration: 'not-verified',
        ...(inputFile !== undefined ? { input: { path: '.agent-loom/input.json',
          validation: validateTaskInput ? 'application-validated' : 'json-only' } } : {}) }, json);
      return 0;
    }
    const taskId = command === 'task inspect' ? options.positionals[0]! : options.required('--task');
    phase = 'task-loading';
    const store = await catalog.open(taskId, options.value('--root'));
    if (command === 'session start') {
      phase = 'dependency-resolution';
      const plan = await prepareSession(store, options.required('--profile'), options.value('--workspace'));
      const hostModule = options.value('--host-module');
      if (hostModule && options.flags.has('--dry-run')) {
        throw new ContainerFailure('InvalidArguments', 'Choose either --dry-run or --host-module.');
      }
      if (!options.flags.has('--dry-run')) {
        phase = 'host-loading';
        const selectedHost = hostModule ?? await readHostBinding(store);
        if (!selectedHost) requireNativeIntegration();
        const host = await loadHost(selectedHost, store);
        phase = 'session-execution';
        const session = await executeSession(store, plan, host, { id: 'local-operator' });
        output({ status: session.status, executed: true, session }, json);
        return session.status === 'completed' ? 0 : 1;
      }
      output({ status: 'planned', executed: false, native_integration: 'not-verified', ...plan }, json);
      return 0;
    }
    phase = 'inspection';
    const snapshot = await inspectTask(store);
    if (command === 'task inspect' && options.flags.has('--summary')) {
      const summary = summarizeTask(snapshot);
      if (json) output(summary, true); else printTaskSummary(summary);
    }
    else if (command === 'task inspect') output(snapshot, json);
    else {
      const entries = command === 'session inspect' ? snapshot.sessions : snapshot.artifacts;
      const entry = entries.find((item) => item.id === options.positionals[0]);
      if (!entry) throw new ContainerFailure('PreconditionNotSatisfied', 'Requested record does not exist in this Task.');
      output('payload_ref' in entry && entry.payload_ref.kind === 'file'
        ? { ...entry, payload_location: resolveTaskPath(store.taskRoot, entry.payload_ref.path) } : entry, json);
    }
    return 0;
  } catch (error) {
    const failure = error instanceof ContainerFailure ? error
      : new ContainerFailure('StorageFailure', 'Operation failed. Inspect local configuration and filesystem access.');
    console.error(JSON.stringify({ error: { code: failure.code, message: failure.message, details: failure.details },
      diagnostic: diagnose(failure, knownCommand ? command : 'unknown', phase) }));
    return 1;
  }
}
