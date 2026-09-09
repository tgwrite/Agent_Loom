# C2 analysis composition example

Run `npm run demo` from the repository root. This demonstrates a synthetic producer
and consumer Session linked through the local Task registry after reopening storage.
It does not launch Pi, run C2Forge/C2Decoder, validate a real Handoff, or execute
Postmortem. Temporary payloads and governance records are removed after the run.

`application.ts` and `profiles/` describe the intended native composition. The Pi
Bridge will be supplied by the Runtime layer in Phase 2; automatic loading follows
in Phase 5. Native entrypoint locations must come from ignored local configuration.
