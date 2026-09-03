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
6. Recreate the manifest's derived state, run module smoke assertions, and call
   `complete_organization_reconstruction` only after reconciliation succeeds. Completion removes
   the effective write fence.

If any restore or reconciliation step fails, call `fail_organization_reconstruction` with the
same run ID or leave the active fence in place. Resume only the same run after the fault is fixed;
never route business traffic to an active or failed reconstruction cell.

## Required recovery evidence

A production recovery exercise is complete only when a disposable destination has been wiped,
all enabled restore relations have been applied, counts and checksums match the durable watermark,
derived state has been recreated, a second identical run produces no duplicate effects, and normal
workflows continue after the fence is completed.
