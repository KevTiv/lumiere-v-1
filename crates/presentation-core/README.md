# lumiere-presentation-core

This crate owns the canonical serialized wire models for composed module and
page definitions. It contains no renderer, transport, database, or
authorization dependencies. The `presentation-schema` binary emits the JSON
Schema consumed by generated frontend contract types.

`ModuleDraft` is intentionally limited to approved collection and detail
nodes. Slots are semantic (`primary`/`secondary`); CSS, raw URLs, executable
props, callbacks, and reducer names do not belong in this wire model.
