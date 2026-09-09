# Postmortem compatibility adapter

Current scope: a native aspect Plugin descriptor. Existing Pi Hooks and reflection
logic remain the intended integration path. No reflection implementation is bundled.

Phase 6 must test actual coexistence with the Container observer, an independent
sidecar prompt with empty tools, no reflection in the main context, observer failure
containment, and unchanged domain guards. The descriptor does not establish those
properties by itself.
