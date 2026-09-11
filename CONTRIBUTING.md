# Contributing

Read `AGENTS.md` before making changes. Consult local planning documents when
available, but keep `doc/` and `docs/` excluded from version control.
Keep each change tied to one implementation step and record its actual validation scope.

```sh
npm ci
npm run check
git diff --cached
npm run privacy:history
```

With staged changes, the privacy check scans the exact staged blobs and filenames;
otherwise it scans tracked and non-ignored files. The history command scans all local
branch and tag histories, commit metadata, annotated tags, and historical blobs.
Perform both checks before publishing. Review prose manually as well.

Use relative paths and synthetic fixtures. Keep local reference integrations in
ignored local configuration or outside this checkout. Do not attach raw runtime
logs, task stores, private revisions, or case data to issues and pull requests.
Public CI must run from a clean clone with only public dependencies.

Describe the problem, resulting behavior, tests, and outstanding acceptance limits
in each contribution. Do not claim real compatibility based on mocks or fixtures.

## User documentation

Keep README focused on the project overview and links. User instructions live in
`manual/`; `packaging/INSTALL.md` and `packaging/AGENT_GUIDE.md` retain compatibility
links. The package builder includes the same manual files, and package verification
compares the installed chapters with their public source.

For manual changes, build a local archive with `npm run package:local`, then run
`npm run manual:verify -- <archive.tgz>`. This extracts the tutorial's named code
blocks into an independent application directory, validates them against the
installed public package, and runs the documented synthetic lifecycle.

Add `--native` to install the tutorial's pinned public Pi dependencies and run its
actual extension/Host/model-runtime integration against a local deterministic model
endpoint. This optional check makes no commercial model requests and does not prove
real model quality or compatibility with other native plugins. Evidence stays local.
