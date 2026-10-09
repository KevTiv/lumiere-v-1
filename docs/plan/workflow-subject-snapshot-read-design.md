# Workflow subject snapshot read (Option A) - Phase 1 design and blocker

Status: design only. Implementation is intentionally NOT started; see "Blocker".

## Problem

`start_workflow` needs `subject_revision_hash`; `signal_workflow` needs a full
`ConditionSnapshot` whose hash is `canonical_condition_snapshot_hash`
(`spacetimedb/src/workflow/evaluator.rs:75`) and equals the instance's stored
hash (`runtime.rs:~565-600`). Only server code builds snapshots
(`action_registry.rs` `material_snapshot`, `ai/action_draft_lifecycle.rs`,
`seed.rs`). No read path returns one to a client, so the web UI cannot start or
signal workflows.

## How clients get server-computed data today

- Reducers return nothing. Browser reads go through the api-server BFF
  (`api-server/src/routes/queries.rs`, `query_exec`, `workflow_reads`) or
  subscription SQL built from `subscription-query-policies.json`.
- `#[spacetimedb::view]` exists only in `spacetimedb/src/ai/spend_reads.rs`.
  Views take no arguments, are sender-scoped, and those are registered
  `client_facing: false` (service identity only). A view cannot take
  `(subject_model, subject_id, version)`.
- `#[procedure]` / `ProcedureContext` are not used anywhere in the module and no
  api-server or frontend plumbing calls procedures.
- Private workflow tables are read via `api-server/src/workflow_reads/mod.rs`
  (owner token, identity/company filtering in the BFF). Reducer-written private
  tables such as `workflow_migration_preflight` follow this path. This is the
  only existing pattern that carries reducer-computed data to the web client.
- There is no generic table-to-row accessor. `generated_reconstruction_apply.rs`
  only deserializes canonical row JSON into inserts; it does not read rows.

## Chosen design (when unblocked)

Reducer `request_workflow_subject_snapshot(organization_id, company_id,
params{subject_model, subject_id, workflow_version_id})` writes one upserted row
into a private `workflow_subject_snapshot` table keyed by
(requester, org, company, model, subject, version). The BFF exposes it as a
private workflow resource `workflow-subject-snapshots`, filtered to the caller
identity and allowed companies. The client then passes `fields` and
`subject_revision_hash` unchanged to `start_workflow` / `signal_workflow`.

Builder: pure fn `build_condition_snapshot(model, subject_id, row, allowlist)`
next to `action_registry.rs`, using a closed registry of models
(`sale_order`, `purchase_order`, `account_move`, `account_payment`,
`stock_picking`, ...), each with explicit `field_key -> column` and type
coercion (Integer/Decimal/Money/Text/Date/Timestamp/Code/Boolean/Null). Errors:
`no snapshot adapter for model X`; `field_key 'k' not available for model X`.
Hash via `canonical_condition_snapshot_hash` only. Permission: same as the
start/signal use plus read access to the subject; company/org scope guard on the
subject row.

## Blocker (why Phase 2 was not started)

Every variant needs a NEW table (a view/procedure cannot take the arguments, and
a column on an existing table is rejected by the PG ledger rules). A new table
is part of the durable PostgreSQL projection even with a `derived_rebuildable`
storage class, so it requires generated and cross-stack artifacts that cannot be
hand-written or verified without cargo and codegen:

- storage-policy entry, reconstruction manifest and `generated_reconstruction_apply.rs`;
- a pending durable PG follow-up migration promoted into
  `lumiere-codegen/pg-migration-ledger` (the release workflow step "Require
  promoted durable migrations" fails otherwise), a `Migration` entry in
  `api-server/src/cold_tier/migrate.rs`, and a bump of
  `durable_postgres.application_catalog_version` in
  `release-compatibility-manifest.json`;
- api-server `workflow_reads` arm, `is_private_workflow_resource`,
  `query_exec_non_registry.json`, and a frontend query hook.

## Options

1. (Recommended) Run codegen on a machine with cargo and the spacetime CLI,
   then land the table, reducer, builder, BFF arm and migration promotion in
   one change set as described above.
2. Add `#[procedure]` support end to end (module, api-server HTTP bridge,
   generated client). Larger platform change; the CLAUDE.md rule against
   inventing APIs applies until the repo has a procedure precedent.
3. Server-side BFF compute in api-server. Rejected: it would have to
   reimplement the canonical hash, which must stay single-sourced in
   `evaluator.rs`.
