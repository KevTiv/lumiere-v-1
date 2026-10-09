# Handoff: workflow subject snapshot backend + contract-release work

Audience: someone with a machine that has `cargo`, the `spacetime` CLI and the
repo's codegen tooling (the Claude cloud sandbox has none of these).
Branch with the design: `claude/workflow-snapshot-backend` (design note only,
no code): `docs/plan/workflow-subject-snapshot-read-design.md`.

## Goal

Let the web UI start and signal workflows. `start_workflow` and `signal_workflow`
(`spacetimedb/src/workflow/runtime.rs` ~340 and ~565) need a server-built
`ConditionSnapshot` / `subject_revision_hash`. Nothing returns one to a client
today. Build the read path described in the design note, then wire the UI.

## Task 1 - backend change set (one PR, needs codegen tooling)

Follow the design note, "Chosen design". In short:

1. Private table `workflow_subject_snapshot` (one upserted row per
   requester, org, company, model, subject id, version).
2. Reducer `request_workflow_subject_snapshot(organization_id, company_id,
   params {subject_model, subject_id, workflow_version_id})`:
   - permission consistent with `start_workflow` / `signal_workflow`, plus read
     access to the subject; company/org scope guard on the subject row;
   - builds the snapshot with a pure `build_condition_snapshot(model,
     subject_id, row, allowlist)` placed next to `action_registry.rs`.
3. Builder: closed registry of supported models (start with `sale_order`,
   `purchase_order`, `account_move`, `account_payment`, `stock_picking`), each
   with explicit `field_key -> column` mapping and type coercion
   (Integer/Decimal/Money/Text/Date/Timestamp/Code/Boolean/Null). Errors:
   `no snapshot adapter for model X`, `field_key 'k' not available for model X`.
   Hash with `canonical_condition_snapshot_hash` (`workflow/evaluator.rs:75`)
   only; do not reimplement it.
4. Read side: arm in `api-server/src/workflow_reads/mod.rs`, entry in
   `is_private_workflow_resource`, `crates/stdb-auth/assets/query_exec_non_registry.json`
   (resource `workflow-subject-snapshots`, filtered to the caller identity and
   allowed companies).
5. Durable-projection artifacts for a new table: storage-policy entry,
   reconstruction manifest, regenerated `generated_reconstruction_apply.rs`, a
   promoted migration in `lumiere-codegen/pg-migration-ledger/`, a `Migration`
   entry in `api-server/src/cold_tier/migrate.rs`, and a bump of
   `durable_postgres.application_catalog_version` in
   `release-compatibility-manifest.json`. (The release workflow step "Require
   promoted durable migrations" in `.github/workflows/release-contracts.yml`
   fails without them, per the Phase 1 reading.)
6. Manifests, hand-registered like earlier backend work: see
   `git show fc812715 --stat` (new reducers: `contract-operation-ids.json`,
   `reducer-exposure.json` with `"exposure": "session"` and a reason,
   `operation-contracts/*.json`, `reducer-stdb-invalidation.json`) and
   `git show db3666be --stat` (making tables readable).
7. Rust tests (follow `spacetimedb/tests` workflow layout, e.g. `runtime_test.rs`):
   - golden vector: fixed snapshot -> fixed expected `sha256:<hex>` (none exists
     in the repo today; derive from `evaluator.rs:75-135` and verify by running);
   - field mapping and type coercion per supported model;
   - unsupported model error; allowlisted-but-unavailable field error;
   - cross-tenant denial;
   - a builder-made snapshot passes `validate_condition_snapshot` and
     `signal_workflow`'s hash checks (canonical + equals the instance's stored
     hash + subject_model/subject_id match).

Alternatives considered (see design note): procedures end to end (no precedent
in the repo), or computing in the api-server (rejected: would duplicate the hash).

Acceptance: Rust tests pass; Release contracts workflow green and the pin commit
lands; `frontend-contracts` passes against the new pin.

## Task 2 - frontend (after Task 1 is merged and pinned)

Branch `claude/pass26-ui` (identical to `claude/pass25-ui`, no commits yet) was
cut for this. Hooks and wrappers already exist: `useStartWorkflow`,
`useSignalWorkflow` (`frontend/packages/query-hooks/src/hooks/workflows.ts` ~280,
~294; `frontend/packages/stdb/src/commands/workflows-http.ts`).

- Client contract: call the reducer; read your own row from
  `workflow-subject-snapshots`; pass `subject_revision_hash` to `start_workflow`
  and the whole snapshot unchanged to `signal_workflow`.
- Start: action on Published version rows, gated on `workflow_instance:create`;
  subject id limited to the version's model; optional singleton key; keys via
  `crypto.randomUUID()`.
- Signal: action on Active instance rows, gated on `workflow_instance:write`;
  signal key from the version's edge `signal_key` values; send `expected_revision`
  from the instance row; show the stale-revision and "subject revision changed"
  errors as the server words them.
- Use new `data-testid`s; leave existing Simulate/retire ids alone
  (`frontend/web/tests/e2e/workflows-gate-ui.spec.ts`).
- Option fields in builders spelled explicitly (`{some}` / `{none: []}`), tests on
  the final wire JSON.

## Contract-release gotchas observed in this work (read before pushing)

How the pipeline behaves:
- `Release contracts` (`.github/workflows/release-contracts.yml`) runs on pushes
  to non-main branches touching `spacetimedb/**`, `crates/presentation-core/**`,
  `lumiere-codegen/**`, `crates/stdb-auth/assets/resource_registry.json` or the
  two contract workflows. It adds two bot commits: `chore(contracts): regenerate
  for vX` then `chore(contracts): publish and pin vX`. Only the pin commit makes
  the web type check see new reducer keys.
- `frontend-contracts` (workflow "Semantic index Q0") type-checks the web app
  against the pinned `@lumiere/contracts`. A new reducer used by the UI fails
  with `Argument of type '<reducer>' is not assignable to parameter of type
  'StdbBffNamedReducerKey'` until the pin lands. Land the backend change before
  (or in the same PR as) any UI that calls it.
- Workflow runs triggered by the bot's commits show `action_required` and wait
  for a person with write access to approve them. A push by a person does not.
- Re-running two sets of runs at once makes them cancel each other (shared
  concurrency group). The `E2E gate` check reports cancelled runs as a failure;
  that is not a test failure. Re-run one head at a time.
- The Claude GitHub connector gets 403 on `rerun_workflow_run`; re-runs must be
  done by a person.
- Local `node_modules` hold a stale `@lumiere/contracts`: expect tsc errors in
  `packages/query-hooks/src/hooks/documents.ts`, `pass9-record-actions.ts` and
  `packages/ui/src/crm-record-chatter.tsx` locally; CI is authoritative.

Manifest/exposure rules:
- Exposure of a reducer to browser sessions is a security decision: add it with a
  reason line in `reducer-exposure.json` and say so in the PR (precedent:
  `release_document_legal_hold`, commit c9782bac). Do not expose a reducer that
  carries an explicit "trusted only" reason.
- `lumiere-codegen/operation-contracts/operations.json` has no entry for several
  accounting reducers (assets, bank statements, accounts, consolidation); their
  `client_facing` value was not verifiable. Check before relying on them.
- Generated `stdb-http-option-fields.json` lacks some param structs, turns numbers
  <= 0 into `none`, and lists a stale `salvage_move_id` on `CreateAccountAssetParams`.
  Frontend builders work around it by spelling Option fields out; the real fix is
  in the generator.
- Do not hand-edit generated bindings or contract artifacts; the workflow
  regenerates them.

## Open decisions not covered above

- `cancel_account_move` does not reverse budget actuals or reconciliation, so
  resetting a cancelled move to draft can double-count.
- Document sharing-link design.
- Whether `mark_notification_read` should need `mail_message` read or write.
