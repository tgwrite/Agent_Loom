# C2Forge compatibility adapter

Current scope: a native domain Plugin descriptor. The empty Capability list makes
no claim about actual native tools; those keep their existing registration.

Phase 3 will observe an existing READY `DecoderHandoffView` V3 publication and register
its original reference, digest, Task, producer Session and verification metadata.
It must not duplicate domain proof or publication verification logic.
Native installation and revision information stays in local configuration.
