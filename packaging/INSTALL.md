# Install the local candidate

Use Node.js >=24.12.0 with npm. Obtain the local candidate `.tgz` and SHA256SUMS;
this version is not published to an npm registry. Keep the archive for reinstalling
projects that refer to it as a local dependency. The archive requires no install
scripts, compiler, or third-party runtime downloads.

## Command-line tool

From the directory containing the archive:

```sh
npm install --global ./agent-loom-0.1.0-alpha.5.tgz --offline --ignore-scripts --no-audit --no-fund
loom --version
loom --help
```

If the shell cannot find `loom`, inspect `npm prefix --global` and ensure its
command directory is on PATH: the prefix itself on Windows, or its `bin` child
on Linux. A project-local install below is another supported option.

## Project dependency and SDK

In a separate, empty project, copy the archive into the project first:

```sh
npm init -y
npm install ./agent-loom-0.1.0-alpha.5.tgz --save-exact --offline --ignore-scripts --no-audit --no-fund
npm pkg set "scripts.loom=loom"
npm run loom -- --version
```

Create an `.mjs` file, or use an ESM project:

```js
import { LocalTaskStore, prepareSession, executeSession, inspectTask } from 'agent-loom';
import { createPiApplicationHost } from 'agent-loom/runtime-pi';
```

TypeScript declarations are included. The SDK uses ESM; CommonJS and browser use
are not part of this candidate's acceptance scope. Global CLI installation does
not replace installing the SDK dependency in your project.

## Synthetic installation example

After the project-local installation:

```sh
node node_modules/agent-loom/examples/minimal/example.mjs ./sample-task
npm run loom -- task inspect install-example --root ./sample-task
```

The example executes a synthetic producer and consumer using installed Core APIs,
checks the exact accepted digest, and leaves the Task available for inspection.
Its expected summary is two completed Sessions, one Artifact and one consumption.
It never invokes Pi, a business plugin or a model. Use a fresh target directory
for each run; the example does not overwrite an existing Task.

## Real applications, updates and removal

A real Application must supply its definition, local Host, compatible Pi SDK,
plugin bindings, input contract and model access. Install those in your own
application project. Do not import files from Loom's source or test directories.
Application dependencies may have additional Node/platform/network requirements.

Use the same installation command with a newer archive to update. To remove the
global command use `npm uninstall --global agent-loom`; for a project dependency,
run `npm uninstall agent-loom` in that project. Loom has no install/uninstall
hooks that migrate or delete user Tasks. Keep Task data outside installation
directories. Read compatibility notes before changing versions; arbitrary schema
downgrades are not supported.

Local model configuration, credentials, Task records and reports are private
runtime data and must not be included in public package uploads or logs.
