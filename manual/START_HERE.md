# Getting started with Agent Loom

For an agent or developer using the installed package. These instructions use the
public APIs available in **0.1.0-alpha.7**. No framework, plugin or test implementation
reading is required. Keep using the project-local CLI so an older global installation
cannot silently select another version.

## 1. Choose what you are doing

| Your job | Required inputs | Next step |
| --- | --- | --- |
| Call an existing Loom application | Its Application module, Host, dependencies and entry documentation | Step 4 and the [CLI/SDK calling guide](AGENT_API.md) |
| Build an application from already adapted plugins | Adapter package names/versions, exported registrations and artifact contracts | Compose the Application using the [adapter API](ADAPTER_API.md) |
| Connect a native Pi plugin without a Loom adapter | Plugin installation and entry documentation, tool/command API, input/output rules | Follow the complete [native integration tutorial](NATIVE_INTEGRATION.md), then substitute the documented plugin protocol |
| Learn the lifecycle before using a model | The Loom archive only | Run step 3 |

**Installation does not create an application.** Loom supplies Core, the Agent
facade and the Pi bridge. An application supplies its plugin descriptors, native
registrations, domain validation and model configuration. Installing a native Pi
package does not automatically supply a Loom registration.

Alpha.6 does not include a catalog of ready-made third-party adapters. The examples
under `test/` in the repository are contributor experiments, not installation
dependencies. Reuse a separately documented adapter when one exists. Otherwise,
implement the boundary using the plugin's **documented API** and the contracts
below. If the plugin does not document its entry or output protocol, record that
specific missing contract; do not infer it from the package name or claim support.

## 2. Install and establish the version

Use Node.js >=24.12.0 and npm for Loom; native dependencies can require a newer
Node version. Download the `.tgz`, `SHA256SUMS` and `INSTALL.md` from the repository's
GitHub Releases page. In an empty application directory containing the archive:

```sh
npm init -y
npm install ./agent-loom-0.1.0-alpha.7.tgz --save-exact --offline --ignore-scripts --no-audit --no-fund
npx --no-install loom --version
npx --no-install loom --help
```

Expect `0.1.0-alpha.7`. Existing projects skip `npm init -y`. The [installation
guide](INSTALL.md) covers checksums, global CLI use and removal. Keep the archive
at the dependency path recorded in your package manifest and lockfile.

Task names are unique within the CLI's locator index, not merely within a Task
directory. For a project-local index, set this in the shell used for the remaining
commands (and again in a new shell):

PowerShell:

```powershell
$env:LOOM_STATE_DIR = Join-Path (Get-Location) '.loom-index'
```

Bash:

```sh
export LOOM_STATE_DIR="$PWD/.loom-index"
```

Keep `.loom-index/` and Task directories outside version control. Without this
setting the CLI uses its per-user index; choose a Task name that is not already
registered there. Supplying `--root` does not override name uniqueness at creation.

## 3. Check the complete lifecycle without native dependencies

This example is **synthetic** and makes no model requests. Use a fresh `sample-task`
directory and execute each command separately. Do not continue after an unexpected
nonzero exit code.

```sh
npx --no-install loom app validate ./node_modules/agent-loom/examples/integration/measurement.mjs --definition-only --explain --json
npx --no-install loom task create --app ./node_modules/agent-loom/examples/integration/measurement.mjs --root ./sample-task --name sample-task --input ./node_modules/agent-loom/examples/integration/measurement.json --json
npx --no-install loom session start --task sample-task --root ./sample-task --profile produce --json
npx --no-install loom session start --task sample-task --root ./sample-task --profile consume --json
npx --no-install loom task inspect sample-task --root ./sample-task --summary --json
```

Expected final counts: **2 Sessions, 2 Artifacts, 1 consumption, 0 aspect failures**.
The consumer result is `{ "total": 5, "unit": "m" }`. Its file location is in the
consumer Session's `outputs[].payload_ref.path`, relative to `sample-task`.
`business_acceptance` remains `not-evaluated`.

This verifies the installed CLI and cross-Session handoff. It does not install or
validate a real plugin. For your own application, proceed to the native tutorial;
do not turn the example's synthetic SDK into a production runtime.

## 4. Call an existing application

Get the following from its author before invoking: Application path, dependency
installation instructions, Task input schema (if any), callable entry ID, request
data schema, required artifact types and native prerequisites. These are application
contracts; Loom cannot derive their business meaning.

For an application with `application.mjs` in your project:

```sh
npx --no-install loom app validate ./application.mjs --definition-only --explain --json
npx --no-install loom agent discover --app ./application.mjs --json
npx --no-install loom app validate ./application.mjs --json
```

The first command checks declaration structure. The last calls its Host's native
preflight and can load trusted extension code; it does not run domain hooks or
validate a model credential. A custom Host without the preflight export cannot
provide that coverage.

Create a Task only after the application and configuration are ready:

```sh
npx --no-install loom task create --app ./application.mjs --root ./task-one --name task-one --json
```

If the application declares `validateTaskInput`, supply `--input ./input.json` as
documented by that application. Do not assume it accepts missing input. The Task
retains its Application and input snapshots; later edits do not update those
snapshots. Keep the Host and dependencies available at their saved locations.

Describe the chosen entry, construct its request, then Check and Invoke. A **complete
working request and commands**, without placeholder IDs, are in the
[native tutorial](NATIVE_INTEGRATION.md#run-the-application).
Use `--exclusive-writer` on each Invoke and serialize all writers to that Task.

## 5. Map a business requirement to an application

| Decision | Where it belongs | What to specify |
| --- | --- | --- |
| Installed native code | Application dependencies / registration | Exact package version and documented entry file |
| Plugin identity and role | `application.plugins[]` | One ID; `domain` or `aspect`; matching `native.binding_key` |
| One callable operation | `application.profiles[]` | At most one primary, selected aspects, workspace and requirements |
| Input parameters | `profile.entry` and adapter parser | `request_mapping`, Schema, required data and semantic checks |
| Accepted upstream artifact | Profile requirement and `initialize` | Type/version/status, input name, identity and byte verification |
| Native execution | Adapter `run` | Actual tool/command call and domain success criteria |
| Explicit observation or review | Aspect `afterRun` / native hooks | Scope, trigger, independent failures and evidence |
| Output publication | Adapter return value | Existing Task-relative file, declared type/version and verified status |
| Model/provider/authentication | Trusted Host `configure` | Explicit local policy; never request-controlled credentials |

The [API reference](ADAPTER_API.md) defines these fields and callback signatures.
The [native tutorial](NATIVE_INTEGRATION.md) provides every file for one real Pi
integration, including configuration. The [advanced guide](AGENT_GUIDE.md) covers
receipt semantics, data Schema limits, locks and version changes.

## 6. Decide whether the integration passed

Verify each layer separately:

1. Installation: the local CLI has the expected version; public imports resolve.
2. Definition: descriptors, keys, roles and requirements validate.
3. Native readiness: the selected SDK, entries and resources load. Check any
   plugin-specific launcher separately; model and credential readiness may be unchecked.
4. Execution: Invoke has a confirmed outcome. `unknown` is not safe to retry.
5. Handoff: a consumer records the chosen source's ID and accepted digest only after
   successful initialization. A resolved reference alone is not consumption.
6. Outputs: inspect the actual domain output and each required aspect's evidence.
   A completed primary Session does not prove monitoring or review succeeded.

For missing requirements, create or select a valid producer output explicitly.
For ambiguity, choose an artifact ID and bind it by name. Neither condition triggers
automatic scheduling. For an unconfirmed outcome or retained writer lock, inspect
and reconcile effects before another write; deleting the lock is not recovery.

When reporting a blocker, record the version, command, exit code, diagnostic
`reason_code`/`check`, last completed layer and the missing documented contract.
Keep real credentials, paths and task content in private local diagnostics.
