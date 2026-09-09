# Pi Runtime boundary

This package is a scaffold, not an executable Pi extension. `PI_REFERENCE_TARGET`
records the design target only. No Pi dependency is installed before Phase 0 verifies
the actual compatible Host and Plugin contracts.

Phase 2 will introduce `runtime-adapter.ts`, `event-mapper.ts`,
`host-capabilities.ts`, and `session-bridge.ts` against verified APIs. The Bridge will
bind Task and Session identities, capture lifecycle Events, and settle execution
without changing prompts, invoking a model, or rewriting domain Plugins.

Local native entrypoints enter through `PiBridgeConfiguration`; never commit resolved
paths or local configuration. Guard and observer-isolation acceptance stays pending.
