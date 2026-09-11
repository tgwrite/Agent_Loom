# Call an application through CLI or SDK

For agents consuming an existing Loom application. You need its dependency and
configuration instructions, Application module and entry contract. You do not need
to implement a Host again when the application already supplies one. For a new
application, follow [native integration](NATIVE_INTEGRATION.md).

## CLI sequence

The commands below use the application created in the native tutorial. They are
not automatic workflow steps. Execute Invoke only after inspecting Check's result.

```sh
npx --no-install loom agent discover --app ./application.mjs --json
npx --no-install loom agent describe text.normalize --app ./application.mjs --json
npx --no-install loom app validate ./application.mjs --definition-only --explain --json
npx --no-install loom app validate ./application.mjs --json
npx --no-install loom task create --app ./application.mjs --root ./text-task --name text-task --json
```

Use a fresh Task directory; skip Task creation when intentionally inspecting an
existing Task. Describe's `request_schema` defines the envelope and data shape.
Its `inputs`, `participants`, `data_examples` and `effect_declarations` describe the
operation. The application still owns semantic validation and native prerequisites.

## Request JSON

The complete request for the tutorial is:

```json
{
  "schema_version": 1,
  "request_id": "normalize-1",
  "task_id": "text-task",
  "entry_id": "text.normalize",
  "data": { "text": "Hello Loom" }
}
```

| Field | Rule |
| --- | --- |
| `schema_version` | Required, `1` |
| `request_id` | Required caller correlation ID; not an idempotency key |
| `task_id` | Required, must match the opened Task |
| `entry_id` | Required, selected entry ID from Discover/Describe |
| `instruction` | Optional text, only if the adapter explicitly supports it |
| `data` | Optional JSON business parameters, or required when the entry declares it |
| `inputs` | Optional map from declared input name to `{ "artifact_id": "selected-id" }` |

Unknown top-level fields are rejected. A request cannot override the Profile,
Host, model configuration, credentials or required aspects. A JSON Schema accepting
instruction text does not mean every string is semantically supported; read the
application's entry documentation. The tutorial intentionally rejects instruction.

Save the request as `request.json`, then:

```sh
npx --no-install loom agent check --task text-task --root ./text-task --request ./request.json --json
npx --no-install loom agent invoke --task text-task --root ./text-task --request ./request.json --exclusive-writer --json
npx --no-install loom agent inspect --task text-task --root ./text-task --request-id normalize-1 --json
```

Check observes current prerequisites; it does not reserve an input or guarantee
Invoke success. Add `--native-preflight` to Check only when native resource loading
is intended. Model access and business quality are separate from resource readiness.
The CLI reuses the saved Application Host. All writers must cooperate with exclusive
ownership; do not run legacy Session writes concurrently with exclusive Invoke.

## SDK equivalent

After creating the tutorial Task through the CLI, a separate `.mjs` caller can use:

```js
import { connectLoom, createRequest } from 'agent-loom/agent';
import { createSessionHost } from './host.mjs';

const loom = await connectLoom({
  taskRoot: './text-task', taskId: 'text-task', writer_policy: 'exclusive',
  host: { actor: { id: 'application-executor' }, createHost: createSessionHost },
});
const request = { ...createRequest('text-task', 'text.normalize'),
  data: { text: 'Hello Loom' } };
const check = await loom.check(request);
if (check.blockers.length) {
  console.log(JSON.stringify(check));
  process.exitCode = 1;
} else {
  const receipt = await loom.invoke(request);
  console.log(JSON.stringify(receipt));
  if (receipt.execution.status !== 'completed') process.exitCode = 1;
}
```

This executes a **new** attempt. Use either this caller or CLI Invoke for the initial
run, not both to inspect the same result. SDK callers supply `host` explicitly;
`connectLoom` does not automatically import the CLI's saved Host module. Inspect
can open the Task without supplying a Host:

```js
import { connectLoom } from 'agent-loom/agent';
const loom = await connectLoom({ taskRoot: './text-task', taskId: 'text-task' });
console.log(JSON.stringify(await loom.inspect()));
```

SDK `invoke` returns a receipt for execution outcomes, but malformed envelopes or
unsupported arguments can reject the promise. Handle those errors separately from
a returned `execution.status: 'failed'` or `'unknown'`.

## Pass an artifact to another entry

After a producer completes, its receipt's `artifacts` contains IDs, types, versions
and producer Plugin IDs. Select the appropriate ID, check it against Inspect and
the consumer's requirement, and pass it by the declared input name. For example:

```js
const selected = producerReceipt.artifacts.filter(item =>
  item.type === 'text.result' && item.version === '1');
if (selected.length !== 1) throw new Error('Select one intended producer output');
const request = { ...createRequest(taskId, consumerEntryId),
  inputs: { source: { artifact_id: selected[0].id } } };
```

This is a binding recipe for an application that actually declares `consumerEntryId`
and a `source` requirement; the one-entry native tutorial does not invent a consumer.
For a complete two-Session runnable lifecycle, use the synthetic example in
[Getting started](START_HERE.md#3-check-the-complete-lifecycle-without-native-dependencies).
The consumer adapter verifies the selected bytes in `initialize` before consumption
is recorded. A READY label alone does not replace that verification.

## Expected outcomes

Inspect existing execution instead of invoking again. Use
[Troubleshooting](TROUBLESHOOTING.md) to distinguish input blockers, initialization
rejection, native execution, aspect failures and unconfirmed history. Receipt
artifacts are concise references; use Task inspection for payload paths and examine
the real output for business acceptance.
