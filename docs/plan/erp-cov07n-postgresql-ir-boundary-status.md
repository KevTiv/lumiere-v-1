# COV-07: PostgreSQL emission boundary

All generated PostgreSQL DDL target writes now happen after the canonical v2
contract handoff. `lumiere-codegen --postgresql-ir-only` replays the durable
migrations, archive tables, and projection-protocol bootstrap from that handoff;
`--durable-postgresql-ir-only` remains an alias. It reads no SDK bindings or
domain source.

The adapter derives table/column identities, nullable logical types, primary
keys, unique constraints, and indexed column positions from canonical raw
tables/types, validates them against `persistence.postgresql.projection`, and
renders using `persistence.storage` and the existing frozen migration ledger.
Archive targets and read paths come from canonical archive/read contracts.
Malformed or inconsistent contracts fail before any PostgreSQL artifact write.
The early cold-tier stage still plans prerequisite manifests in memory; it no
longer writes SQL. Read-path SQL validation runs on canonical rendered artifacts,
not stale files left in staging.

Release compatibility is deliberately preserved: scalar raw indexes retain the
existing renderer's names and ordering. Composite STDB indexes stay represented
in canonical IR, but introducing new PostgreSQL composite indexes requires an
explicit layout migration. The inline SDK `ScheduleAt` algebraic type retains
its released object-valued JSONB codec.

Projection-only watermark, quarantine, and status tables have no STDB business
rows. Their existing bootstrap compatibility templates are selected by the
canonical commit-stream contract; STDB-backed commit/row-change template columns
are validated against canonical projection types. No new business authority or
domain-specific SQL has been introduced. Complete template body representation
in canonical IR remains outside this bounded compatibility-preserving change.

The explicit staging parity test checks the current 510-table handoff against
the prior renderer, every released migration (including frozen migration 14),
and every archive/protocol SQL artifact byte-for-byte. Focused rejection tests
cover invalid versions, types, nullable flags, keys, index positions, identifiers,
and unsupported commit-stream bootstrap metadata. The coordinator also replayed
the IR-only emitter and executed all five generated migration files plus the
archive/bootstrap artifacts in isolated PostgreSQL 16.15. Migration 14 added
exactly the four cost tables; replay preserved the table count. See the
[bounded runtime evidence](../evidence/cov07-completion-runtime-2026-10-11.md).
This is generated-DDL execution, not the full API migration/projector proof.
