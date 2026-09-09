# Contributing

Read `AGENTS.md` and the implementation baseline before making changes.
Keep each change tied to one roadmap step and record its actual validation scope.

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
