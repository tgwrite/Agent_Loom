import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ContainerFailure, LocalTaskStore, inspectTask, prepareSession, resolveTaskPath, validateApplication } from '../../container-core/src/index.ts';
import type { ApplicationDefinition } from '../../container-core/src/index.ts';
import { requireNativeIntegration } from '../../runtime-pi/src/index.ts';
import { TaskCatalog } from './catalog.ts';

const help = `Agent Loom (development preview)

loom app validate <application.ts> [--definition-only] [--json]
loom task create --app <application.ts> --root <directory> --name <id> [--json]
loom task inspect <id> [--root <directory>] [--json]
loom session start --task <id> --profile <profile> [--root <directory>] [--workspace <relative>] [--dry-run] [--json]
loom session inspect <id> --task <task-id> [--root <directory>] [--json]
loom artifact inspect <id> --task <task-id> [--root <directory>] [--json]

Native Pi execution is not ready. Definition validation and dry-run plans are
explicitly separate from real execution. Local Task indexing uses LOOM_STATE_DIR
when set. Use --root to locate a Task without that index.`;

function argumentsFor(args: string[], allowed: readonly string[]) {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) { positionals.push(arg); continue; }
    if (!allowed.includes(arg) || flags.has(arg)) throw new ContainerFailure('InvalidArguments', 'Unknown or duplicate option.');
    if (['--json', '--definition-only', '--dry-run'].includes(arg)) flags.set(arg, true);
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

async function loadApplication(file: string): Promise<ApplicationDefinition> {
  let value: unknown;
  try {
    const module = await import(pathToFileURL(resolve(file)).href) as Record<string, unknown>;
    value = module.default ?? module.application;
  } catch {
    throw new ContainerFailure('InvalidDefinition', 'Unable to load Application module. Export the definition as default or application.');
  }
  validateApplication(value);
  return value;
}

function output(value: unknown, json: boolean): void {
  // JSON is also useful locally; the human renderer below emphasizes Task relationships.
  if (json || !value || typeof value !== 'object' || !('sessions' in value)) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  const snapshot = value as Awaited<ReturnType<typeof inspectTask>>;
  console.log(`Task: ${snapshot.task.id}\nApplication: ${snapshot.task.application_id}@${snapshot.task.application.version}`);
  for (const session of snapshot.sessions) {
    console.log(`\nSession: ${session.id}\nProfile: ${session.profile_id}\nWorkspace: ${session.workspace}`);
    console.log(`Runtime: ${session.runtime.name}@${session.runtime.version}\nActor: ${session.actor.id}\nStatus: ${session.status}`);
    console.log(`Primary: ${session.primary_plugin_id ?? '(none)'}\nAspects: ${session.aspect_plugin_ids.join(', ') || '(none)'}`);
    for (const artifact of session.produced) console.log(`Produced: ${artifact.type}@${artifact.version} ${artifact.verification.status} (${artifact.id})`);
    for (const consumption of session.consumed) console.log(`Consumed: ${consumption.artifact_id} <- ${consumption.producer.session_id}`);
    for (const [plugin, counts] of Object.entries(session.plugin_artifact_counts)) {
      for (const [type, count] of Object.entries(counts)) console.log(`Artifacts: ${plugin} ${type} = ${count}`);
    }
    if (session.failure) console.log(`Failure: ${session.failure.code}: ${session.failure.message}`);
    console.log(`Events: ${session.events.map((event) => event.type).join(', ')}`);
  }
  if (!snapshot.sessions.length) console.log('Sessions: none');
}

export async function main(args: string[]): Promise<number> {
  try {
    if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]!))) {
      console.log(help);
      return 0;
    }
    const command = args.slice(0, 2).join(' ');
    const allowed: Record<string, string[]> = {
      'app validate': ['--definition-only', '--json'],
      'task create': ['--app', '--root', '--name', '--json'],
      'task inspect': ['--root', '--json'],
      'session start': ['--task', '--profile', '--root', '--workspace', '--dry-run', '--json'],
      'session inspect': ['--task', '--root', '--json'],
      'artifact inspect': ['--task', '--root', '--json'],
    };
    if (!allowed[command]) throw new ContainerFailure('InvalidArguments', 'Unknown command. Use loom --help.');
    const options = argumentsFor(args.slice(2), allowed[command]);
    const needsPositional = !['task create', 'session start'].includes(command);
    if (options.positionals.length !== (needsPositional ? 1 : 0)) {
      throw new ContainerFailure('InvalidArguments', 'Incorrect number of positional arguments.');
    }
    const json = options.flags.has('--json');
    if (command === 'app validate') {
      const application = await loadApplication(options.positionals[0]!);
      if (!options.flags.has('--definition-only')) requireNativeIntegration();
      output({ application: application.id, definition: 'valid', native_integration: 'not-verified',
        profiles: application.profiles.map((profile) => profile.id) }, json);
      return 0;
    }
    const catalog = new TaskCatalog();
    if (command === 'task create') {
      const application = await loadApplication(options.required('--app'));
      const id = options.required('--name');
      const root = options.required('--root');
      await catalog.ensureAvailable(id);
      const store = await LocalTaskStore.create(root, { schema_version: 2, id,
        application_id: application.id, application, title: id, created_at: new Date().toISOString() });
      await catalog.register(store);
      output({ task: id, application: application.id, status: 'created', native_integration: 'not-verified' }, json);
      return 0;
    }
    const taskId = command === 'task inspect' ? options.positionals[0]! : options.required('--task');
    const store = await catalog.open(taskId, options.value('--root'));
    if (command === 'session start') {
      const plan = await prepareSession(store, options.required('--profile'), options.value('--workspace'));
      if (!options.flags.has('--dry-run')) requireNativeIntegration();
      output({ status: 'planned', executed: false, native_integration: 'not-verified', ...plan }, json);
      return 0;
    }
    const snapshot = await inspectTask(store);
    if (command === 'task inspect') output(snapshot, json);
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
    console.error(JSON.stringify({ error: { code: failure.code, message: failure.message, details: failure.details } }));
    return 1;
  }
}
