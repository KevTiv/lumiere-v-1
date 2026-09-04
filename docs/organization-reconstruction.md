# Organization reconstruction

Organization reconstruction rebuilds a disposable SpacetimeDB organization cell from the
durable PostgreSQL projection at one exact commit watermark. PostgreSQL is the durable source;
SpacetimeDB remains the only writable business-state engine.

The generated `reconstruction-manifest.json` in `lumiere-contracts` is the authority for table
classification and dependency order:

- `restore_order` contains durable organization-owned tables restored parent before child.
- `recreate_order` contains derived or target-local state that must be rebuilt on the destination.
  Reconstruction fences and batch receipts are always created locally and are never copied from
  the source cell.
- `excluded_tables` contains platform-global state bootstrapped independently from an organization.

## Trusted restore protocol

1. Resolve the destination placement generation and PostgreSQL projection watermark on the
   server. The organization, placement, table names, columns, and watermark are not client input.
2. Register the destination's `organization_reconstructor` service identity, then call
   `begin_organization_reconstruction`. This creates the organization writer fence.
3. Read each manifest relation from PostgreSQL at the declared watermark in strict primary-key
   order. Submit batches of at most 256 rows and 4 MiB through
   `apply_organization_reconstruction_batch`.
4. Mark every table's last batch explicitly. An empty table uses one empty final batch. Exact
   retries are accepted through deterministic receipts; a conflicting retry or primary-key value
   aborts the transaction.
5. Compare PostgreSQL and SpacetimeDB counts and canonical checksums for every projected
   organization relation. Both stores must still report the declared watermark.
6. Validate the generated recreated-state set, run module smoke assertions, and call
   `complete_organization_reconstruction` only after reconciliation succeeds. Completion rebuilds
   policy and project-margin caches idempotently inside the fenced STDB transaction, verifies their
   organization coverage, and only then removes the effective write fence.

The reconstruction policy conservatively restores seven snapshot tables whose historical period,
actor, or as-of inputs cannot currently be reproduced at the durable watermark. Only
`policy_snapshot` and `project_margin_snapshot` are rebuilt; fence and receipt rows remain
target-local. This prevents a successful drill from silently replacing point-in-time evidence with
new values computed at recovery time.

If any restore or reconciliation step fails, call `fail_organization_reconstruction` with the
same run ID or leave the active fence in place. Resume only the same run after the fault is fixed;
never route business traffic to an active or failed reconstruction cell.

## Required recovery evidence

A production recovery exercise is complete only when a disposable destination has been wiped,
all enabled restore relations have been applied, counts and checksums match the durable watermark,
derived state has been recreated, a second identical run produces no duplicate effects, and normal
workflows continue after the fence is completed.

## C7-R1 and C7-R2 automated proofs

The fast C7-R1 test in `api-server::cold_tier::reconstruction` runs the complete coordinator against
a persistent disposable source and destination model. It injects a failure after a committed
batch, resumes the same run from receipts, verifies the durable watermark and table digests,
checks the writer fence, repeats the restore with a fresh run ID against the already-populated
destination, and emits run ID, generation, watermark, classification counts, verification state,
and elapsed time in the serializable `ReconstructionReport`. It also checks that
the generated restore, recreate, and excluded sets are disjoint and match their declared coverage.

The C7-R2 proof in `api-server::organization_placement` configures two logical cells and durable
stores entirely inside the trusted server boundary. A move follows checkpoint, source lifecycle
fence, target materialization at the next generation, verification, and only then the authoritative
placement flip. Failed or cross-organization verification restores the exact source placement;
operations carrying the old generation are rejected after a successful flip. Hydration receives
the generation from the resolved placement rather than assuming generation one.

These tests are deterministic CI proofs. They do not replace the production acceptance drill
against restored managed PostgreSQL and a freshly published SpacetimeDB destination; that drill
must capture the same evidence before production recovery or multi-cell movement is enabled.
