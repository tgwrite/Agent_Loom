# C2 analysis composition example

Run `npm run demo` from the repository root. This demonstrates a synthetic producer
and consumer Session linked through the local Task registry after reopening storage.
The consumer records a simulated acceptance so Task inspection can reconstruct both
production and consumption. It does not launch Pi, run C2Forge/C2Decoder, validate a real Handoff, or execute
Postmortem. Temporary payloads and governance records are removed after the run.

`application.ts` and `profiles/` describe the intended native composition. The Pi
Bridge will be supplied by the Runtime layer in Phase 2; automatic loading follows
in Phase 5. Native entrypoint locations must come from ignored local configuration.

`agent-loom.app.ts` is the CLI entrypoint for this definition. The Loom contract is
`c2forge.decoder-handoff@3`; the native `DecoderHandoffView` schema and original file
remain the domain Plugins' responsibility. Postmortem contract identifiers are
provisional descriptor metadata until native publication mapping is verified.
