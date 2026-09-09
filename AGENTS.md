# Agent Loom contributor instructions

## Public repository and privacy

This is a public, open-source repository. These rules apply to source, documentation,
fixtures, examples, dependency metadata, generated files, commit messages, author and
committer metadata, branches, tags, issues, pull requests, releases, and CI output.

- Never publish private repository names, URLs, remotes, revision identifiers, source
  code, or internal integration details. Reference Plugin IDs in the implementation
  baseline are conceptual integration identifiers, not permission to disclose their
  repositories or contents.
- Never publish machine-specific absolute paths, home directories, usernames,
  hostnames, personal names, personal email addresses, company names, internal domains,
  customer information, credentials, tokens, or other identifying information.
- Use repository-relative paths, runtime configuration, and synthetic fixtures.
  Examples must use neutral identifiers and reserved example domains.
- Keep real Plugin checkouts, revision pins, case data, Handoffs, runtime events,
  reports, and local configuration outside version control. `.gitignore` is a first
  barrier, not a substitute for reviewing staged content and reachable history.
- Root `doc/` and `docs/` are local-only, ignored planning directories. Preserve
  local files, but never stage, force-add, or publish these directories again.
- Do not copy raw local output into public documents, issues, commits, or CI fixtures.
  Publish only reviewed, anonymized results. Public CI must need no private access.
- Use the project identity `Agent Loom contributors <contributors@example.invalid>`
  for automated commits here; configure it locally, never change global Git identity.
  Disable inherited commit signing for automated commits to avoid identity disclosure.
- Before committing or pushing, run `npm run check`, inspect the staged diff, and
  inspect commit metadata. Before pushing, also run `npm run privacy:history`.
  Resolve findings before publication. Do not silence a check to publish private data.
- The automated privacy check detects common patterns and enforces an explicit public
  URL allowlist. It cannot prove that prose is free of personal or company information;
  manual review is required. Add public URL exceptions only after verifying the source.
- If sensitive data has already been published, stop further publication, report the
  exposure without repeating the data, and prepare a scoped remediation. Never rewrite
  unrelated history or repositories.

## Implementation baseline

When available locally, read the implementation baseline in `doc/` before changing
scope and track progress in `docs/`. These directories are excluded from publication.
Public contributors can use the boundaries below and the status in `README.md`
without access to local planning documents.

- Existing Plugin first: use native Pi Plugins with thin descriptors/adapters. Do not
  restructure domain cores or reflection logic to satisfy Container interfaces.
- Container owns composition, indexing, dependency resolution, and provenance.
  Plugins own domain truth, Handoff verification, policy, and guards.
- Artifact dependencies never schedule execution. Missing requirements produce
  `PreconditionNotSatisfied`; ambiguous bindings produce `BindingConflict`.
- A Session Run has at most one primary domain Plugin and any number of aspects.
- Container metadata and private Plugin state stay out of the main Agent Context.
  Only explicit effects may change that context. Observer failures must be contained.
- Keep `container-core` independent of Pi. Abstract only the Host surface actually
  required by reference Plugins. Pi 0.85.1 is a proposed target until Phase 0 passes.
- Keep governance under `.agent-loom/`; do not take ownership of domain folders.
  Legacy `.agent-container/` stores require explicit migration; never silently split a Task.
- Tasks retain an Application snapshot. Session workspaces are Task-relative.
  Record Artifact consumption only after a consumer reports successful initialization;
  resolving a reference alone is not consumption. Keep native integration readiness
  distinct from static Application validation.
- Do not add workflow scheduling, planners, multi-agent orchestration, databases,
  permission engines, marketplaces, other Runtime adapters, or Web UI in v0.1.
- Public synthetic tests demonstrate Core behavior only. Never label them as real
  Plugin compatibility, domain trust, sidecar isolation, or complete v0.1 acceptance.

## Development

- Project license: Apache License 2.0 (`Apache-2.0`). Retain `LICENSE` and `NOTICE`;
  preserve the separate license metadata of third-party dependencies.
- Node.js 24.12 or newer; npm workspaces; strict TypeScript with ESM.
- `npm ci` installs pinned public development dependencies.
- `npm run check` runs type checking, behavioral tests, and the publication scan.
- `npm run demo` runs a synthetic cross-Session Artifact example in an OS temporary
  directory and removes that example on completion.
- Keep new code small and tied to the next acceptance step. Test state transitions,
  persistence, dependency boundaries, and failure paths where implemented.
- Do not commit generated output, runtime state, raw logs, or local baseline files.

中文约束：本仓库公开开源，禁止提交或发布私有仓库信息、本机路径、个人信息、
公司信息和真实业务数据。所有示例使用合成数据，所有公开产物及 Git 历史均须审查。
