# CRM Relational Integrity Remediation Plan

**Module:** CRM only  
**Source audit:** CRM relational-integrity and mutation-provenance review, 2026-07-26  
**Owner:** Unassigned  
**Target release:** Unassigned  
**Current readiness:** **Unsafe for real ERP data**  
**Target readiness:** Production ready after every P0/P1 item and release gate is verified  
**Allowed pilot restrictions:** None until CRM imports are disabled, company visibility is constrained, and all P0 write paths are fixed  
**Non-goal:** Adding unrelated CRM features or redesigning non-CRM ERP modules

---

## 1. Purpose

This is the executable remediation plan for the CRM relational-integrity audit.
It covers storage, reducers, import paths, API routes, generated contracts,
frontend mappings, subscriptions, UI refresh behavior, and persisted-data
verification.

Compilation, a successful reducer call, generated types, or a UI success toast
does not close an item. Only the evidence defined below counts as completion.

## 2. Global definition of done

A work item may be marked **Verified** only when every applicable condition is
met:

- [ ] Every stored relation has one documented business source.
- [ ] Every referenced row is loaded before its ID is persisted.
- [ ] Organization, company, permission, lifecycle, type, and operation
      compatibility are validated server-side.
- [ ] Tenant fields come from authenticated context or a validated parent.
- [ ] No ID falls back to zero, the first record, an unsafe cast, or unverified
      metadata.
- [ ] Create, unchanged, replace, and clear semantics are explicit.
- [ ] Collection operations distinguish add, remove, replace, and clear.
- [ ] Multi-record actions are atomic and retry-safe.
- [ ] Read paths enforce the same organization/company policy as writes.
- [ ] Every affected query, projection, and UI panel refreshes after mutation.
- [ ] Generated bindings and frontend mappers match the final backend contract.
- [ ] Persisted-data tests use distinctive, non-default values.
- [ ] Negative tests cover missing, cross-organization, cross-company,
      unauthorized, inactive, archived, deleted, and incompatible targets where
      applicable.
- [ ] When historical-data remediation is in the work package, existing invalid
      data is backfilled, quarantined, or rejected before stricter contracts are
      enabled. Phase 2 explicitly excludes this work and is not gated by it.

Allowed tracker statuses:

```text
Not started
In progress
Blocked
Implemented, unverified
Verified
Deferred with restriction
```

Only **Verified** counts as done.

## 3. Closure evidence

Add this block to each completed item:

```md
Completion evidence:
- Implementation:
- Schema/contract:
- Migration/backfill:
- Persisted positive test:
- Isolation and negative tests:
- Update/collection semantics test:
- Retry/rollback test:
- Fresh read/UI test:
- Generated artifacts and checks:
- Reviewer:
- Completed on:
```

## 4. Canonical implementation patterns

### 4.1 Scoped relation loaders

Use relation-specific loaders that:

```text
load by ID
→ reject missing
→ validate organization
→ validate company or documented shared scope
→ validate permission and user membership
→ validate active/deleted/archived state
→ validate relation-specific type and workflow compatibility
→ return the loaded row for use by the mutation
```

Share tenant-loading mechanics where useful, but keep operation-specific checks
visible. Return `Result`; do not panic on user data. Follow the repository Rust
guidance: borrow rather than clone, use `?` for propagation, and keep error
messages lowercase without trailing punctuation.

Required loaders include contacts, users, companies, stages, leads, partners,
campaigns, media, sources, teams, currencies, lost reasons, products, units of
measure, taxes, tags, segments, identities, operational messages, and calendar
relations.

### 4.2 System-owned context

Organization and active company are protected context, not editable CRM form
fields. When a validated parent owns the company, derive it from that parent.
Do not let frontend filtering substitute for backend authorization.

### 4.3 Explicit patch contracts

The contract must distinguish:

```text
field absent / undefined → unchanged
null                     → explicit clear when allowed
value                    → validate and replace
```

Use `Option<Option<T>>`, a patch enum, or named set/clear reducers where the
transport cannot otherwise preserve all three states.

### 4.4 Explicit association operations

For tags, categories, segments, taxes, and similar collections, expose
unambiguous `add`, `remove`, `replace`, and `clear` behavior. Validate and
deduplicate every ID before changing any association. Enforce uniqueness for
the relation pair where supported.

### 4.5 Atomic idempotent commands

One logical CRM action must validate first and commit all affected rows in one
transaction. Retry must return the existing result or a deterministic duplicate
response rather than creating a second business object.

### 4.6 Relation-aware reads

Important relations must resolve to a stable ID and useful label after refresh.
Missing or archived relations must be visible rather than silently rendered as
an unexplained blank. Read authorization must enforce the selected CRM
organization/company policy on the server.

## 5. Remediation tracker

| ID | Priority | Problem and risk | Required fix | Migration/backfill | Acceptance gate | Status |
|---|---|---|---|---|---|---|
| CRM-RI-001 | P0 | CSV imports persist raw or zero relation IDs | Stage, validate, and atomically promote imported rows through scoped loaders | Quarantine dangling, zero, cross-org, and cross-company IDs | Invalid imports persist nothing; valid distinctive relations survive reload | Implemented, unverified |
| CRM-RI-002 | P0 | Core reducers trust contact, lead, opportunity, and line relation IDs | Apply relation-specific loaders to every create/update/conversion path | Audit and repair existing invalid relations | Full negative relation matrix passes | Implemented, unverified |
| CRM-RI-003 | P0 | Partial updates can clear omitted sibling fields | Introduce explicit unchanged/clear/replace contracts end to end | None unless historical clearing damage is recoverable | Omission preserves; explicit clear clears only the requested field | Implemented, unverified |
| CRM-RI-004 | P0 | Legacy lead API performs independent partial commits | Replace concurrent reducer calls with one atomic command | None | Forced sub-operation failure rolls back the entire update | Implemented, unverified |
| CRM-RI-005 | P0 | Opportunity conversion can create duplicate sales orders | Add conversion idempotency and unique opportunity linkage | Detect and quarantine duplicate opportunity orders | Repeated/concurrent retries produce one sales order | Implemented, unverified |
| CRM-RI-006 | P0 | Contact merge can create cycles and leave stale dependents | Validate hierarchy and repoint every dependent relation atomically | Repair self/cyclic parents and retired-contact links | Merge preserves an acyclic graph and no live dependency targets the source | Implemented, unverified |
| CRM-RI-007 | P0 | CRM reads are organization-scoped despite company-bearing rows | Make company-sensitive base tables private; expose scoped BFF HTTP reads and API WebSocket invalidations | Out of Phase 2 scope; historical-data remediation is a separate release workstream | Company A cannot read company A2/B through the BFF, receives only scoped change signals, and cannot directly read private base tables | Implemented, unverified |
| CRM-RI-008 | P0 | Identity verification and provider provenance are caller-controlled | Move authoritative state to trusted reducers and validate contact/company equality | Out of Phase 2 scope; historical-data remediation is a separate release workstream | Ordinary CRM writers cannot forge verified or inbound/provider state | Implemented, unverified |
| CRM-RI-009 | P1 | Segment evaluation truncates at 500 and deactivates valid members | Evaluate the full scoped population with pagination/indexes | Recompute all dynamic memberships and counts | More than 500 contacts evaluate correctly, excluding deleted contacts | Implemented, unverified |
| CRM-RI-010 | P1 | Inbox assignment, reuse, identity, and message relations are weak | Validate membership/lifecycle/company and make reuse intent-complete | Out of Phase 2 scope; historical-data remediation is a separate release workstream | Invalid assignments and identities fail atomically | Implemented, unverified |
| CRM-RI-011 | P1 | Opportunity lifecycle flags can contradict each other | Replace independent flags and string stage checks with validated transitions | Normalize contradictory states | Impossible state combinations are rejected or unrepresentable | Implemented, unverified |
| CRM-RI-012 | P1 | Several optional relations cannot be cleared | Apply explicit patch semantics to opportunity, contact roles, and conversations | None | Each nullable relation has verified unchanged/set/clear tests | Implemented, unverified |
| CRM-RI-013 | P1 | Merge/tag/segment mutations under-invalidate queries | Invalidate every changed base, association, projection, and count resource | None | Fresh UI shows all changes without broad manual reload | Implemented, unverified |
| CRM-RI-014 | P2 | Category relations are defined but operationally unused | Implement scoped CRUD/assignment or remove the unused surface | Preserve or remove existing rows deliberately | Schema, reducers, subscriptions, and UI agree on one supported model | Implemented, unverified |
| CRM-RI-015 | P2 | Activities use unvalidated string plus ID references | Introduce a typed CRM activity target and scoped resolution | Translate or quarantine unknown legacy references | Unsupported model/ID pairs cannot persist | Implemented, unverified |
| CRM-RI-016 | P2 | Scores and relationship insights can become stale | Define event-driven recomputation or visible snapshot freshness | Recompute stale projections | Mutating source data produces or schedules a verified refresh | Implemented, unverified |
| CRM-RI-017 | P2 | Presence accepts caller-provided display identity | Derive identity from authentication and verify opportunity access | None | A user cannot impersonate another presence label | Implemented, unverified |

## 6. Detailed work packages

### CRM-RI-001 — Make imports safe

**Current evidence**

- `spacetimedb/src/data_ops/crm_imports.rs:46` inserts raw contact company and
  parent IDs.
- `spacetimedb/src/data_ops/crm_imports.rs:126` inserts raw lead relations.
- `spacetimedb/src/data_ops/crm_imports.rs:208` inserts raw opportunity
  relations, allows zero-like parsed IDs, and discards company ownership.

**Required work**

1. Parse into import DTOs that preserve missing versus malformed values.
2. Resolve every relation with the same scoped loaders as interactive commands.
3. Derive company from validated context or parent; never silently store
   `None` or zero.
4. Validate the entire row before inserting anything.
5. Produce an actionable rejection report containing row number and field.
6. Add preflight and promotion phases if batch atomicity cannot be guaranteed.

**Acceptance criteria**

- Missing and malformed required IDs are rejected rather than coerced.
- Cross-organization/company and inactive/deleted relations are rejected.
- One invalid row cannot partially persist its related CRM state.
- Valid imports retain distinctive company, stage, source, currency, contact,
  and team relations after a fresh query.

### CRM-RI-002 — Enforce every core CRM relation

**Current evidence**

- `spacetimedb/src/crm/contacts.rs:343` stores user and parent IDs directly.
- `spacetimedb/src/crm/contacts.rs:630` can change company without create-time
  scope validation.
- `spacetimedb/src/crm/leads.rs:254` stores source, campaign, team, partner, and
  tag relations directly.
- `spacetimedb/src/crm/leads.rs:538` converts a lead with an unvalidated stage.
- `spacetimedb/src/crm/opportunities.rs:251` stores most opportunity relations
  directly.
- `spacetimedb/src/crm/opportunities.rs:709` validates product organization but
  not UoM/tax compatibility.

**Required work**

- Create a relation/provenance matrix before changing contracts.
- Validate contact parents for organization, company, lifecycle, self-reference,
  and cycles.
- Validate users and teams for membership and supported role.
- Validate opportunity stages for company/team, active state, and transition.
- Validate currency, UoM, tax, product, source, campaign, lost-reason, tag, lead,
  contact, and partner compatibility.
- Derive protected tenant and workflow fields on the server.

**Acceptance criteria**

- Every relation has positive persisted proof plus missing, cross-scope,
  unauthorized, inactive, archived/deleted, and incompatible negative proof.
- Failed validation leaves the original row and associations unchanged.

### CRM-RI-003 and CRM-RI-004 — Repair update semantics and atomicity

**Current evidence**

- `spacetimedb/src/crm/contacts.rs:409` replaces every address field.
- `frontend/packages/query-hooks/src/hooks/crm-params-merge.ts:189` strips
  unspecified fields.
- `frontend/packages/stdb/src/stdb-params-json.ts:365` serializes absent option
  fields as explicit `None`.
- `api-server/src/routes/crm.rs:260` sends three independent lead reducer calls.

**Required work**

1. Define a single canonical patch contract shared by reducers, API, generated
   bindings, query hooks, and forms.
2. Remove zero/default reconstruction in update mappers.
3. Replace multi-call lead updates with one reducer command.
4. Document collection behavior independently from scalar patches.

**Acceptance criteria**

- Updating one address/detail field preserves every omitted sibling.
- Explicit clear affects only the selected nullable field.
- Validation failure in any patch field rolls back the complete patch.
- Contract tests cover direct reducer, HTTP, mapper, and UI submission paths.

### CRM-RI-005 — Make opportunity conversion retry-safe

**Current evidence**

- `spacetimedb/src/crm/opportunities.rs:808` always creates a new sales order and
  does not first resolve an existing order by `opportunity_id`.

**Required work**

- Define one opportunity-to-sales-order uniqueness rule.
- Validate all opportunity lines and sales relations before creating the order.
- Return the existing conversion result on retry.
- Choose the won stage through validated configuration, not the first
  organization stage with a matching name/state.

**Acceptance criteria**

- Sequential and concurrent repeated commands create exactly one sales order
  and one expected line set.
- A failed conversion changes neither the opportunity nor sales records.
- Existing duplicate orders are detected before enabling the uniqueness rule.

### CRM-RI-006 — Make contact merge complete and acyclic

**Current evidence**

- `spacetimedb/src/crm/duplicate.rs:472` can repoint the target contact to itself.
- `spacetimedb/src/crm/duplicate.rs:491` retires the source without repointing
  phone identities, roles, conversations, and relationship insights.

**Required work**

- Reject self-merge, ancestor/descendant cycles, and incompatible company merges.
- Inventory every table carrying a contact ID and define merge behavior.
- Repoint or deliberately retain historical relations atomically.
- Recompute segment/tag/category counts and deduplicate association rows.
- Preserve an auditable merge record.

**Acceptance criteria**

- Graph traversal proves no self-parent or cycle after merge.
- No live operational relation targets the retired source.
- Counts and associations equal their persisted rows.
- Retrying the same merge is deterministic and creates no duplicates.

### CRM-RI-007 and CRM-RI-008 — Enforce company and trust boundaries

**Current evidence**

- `frontend/packages/stdb/src/queries/erp-subscriptions.ts:498` selects CRM data
  by organization.
- `frontend/packages/stdb/src/live/projection.ts:35` does not company-filter CRM
  resources.
- `api-server/src/query_exec.rs:1188` applies organization/lifecycle filtering
  without a CRM company boundary.
- `spacetimedb/src/crm/contact_identities.rs:225` accepts caller-selected
  verification state and a company that need not match the contact.
- `spacetimedb/src/crm/inbox.rs:251` accepts caller-owned provider provenance.

**Required work**

- Decide which CRM entities are company-owned, organization-shared, or
  explicitly shared across selected companies.
- Make company-sensitive CRM base tables private under SpacetimeDB 2.0. Expose
  CRM rows only through authenticated BFF HTTP reads. Use the authenticated
  api-server WebSocket bridge for scoped change/invalidation signals followed
  by a BFF requery; do not expose direct client table reads.
- Enforce the same policy in reducers, authenticated BFF HTTP queries,
  WebSocket bridge subscriptions, selectors, exports, and reports.
- Require identity company to match the contact unless a documented shared
  identity model is introduced.
- Make verification transitions proof-bearing and server-owned.
- Separate user send intent from provider receive/delivery callbacks.

**Acceptance criteria**

- A persisted fixture contains organization A with companies A1 and A2 plus
  organization B with company B1, distinct users/memberships, and distinctive
  rows for every CRM resource and ownership class.
- Through authenticated BFF HTTP reads, an A1 caller receives only A1 plus
  explicitly documented organization-shared rows, never A2 or B1; equivalent
  assertions pass for A2 and B1 callers.
- After a scoped CRM mutation, the authenticated API WebSocket bridge emits a
  change signal only to eligible resource/company subscriptions. The client
  requeries the authenticated BFF and receives the exact permitted set; the
  bridge does not distribute private CRM row payloads.
- An ordinary authenticated client cannot query or subscribe to any private CRM
  base table directly. Attempts using direct table SQL/generated-table access
  fail rather than returning rows for later client-side filtering.
- Initial BFF load and every WebSocket-triggered BFF requery return the same
  permitted set after reconnect and browser reload.
- Normal CRM users cannot forge verification timestamps, inbound direction,
  delivered state, provider IDs, operational-message linkage, or another
  user’s identity.

### CRM-RI-009 through CRM-RI-017 — Complete secondary semantics

Implement after P0 contracts stabilize:

1. Replace the 500-contact segment scan with complete, deterministic evaluation.
2. Exclude deleted contacts and recompute memberships/counts atomically.
3. Validate inbox identity, assignee, external thread, and reuse compatibility.
4. Model opportunity state as validated transitions; eliminate contradictory
   won/lost combinations and exact-name workflow checks.
5. Add explicit clear support for nullable opportunity, role, and conversation
   relations.
6. Correct invalidation for merge, tags, categories, relationships, segments,
   identities, roles, conversations, events, and derived counts.
7. Either complete category CRUD/assignment/read support or remove the unused
   model after migration review.
8. Replace generic activity references with a typed source reference.
9. Define freshness and automatic recomputation for scores and insights.
10. Derive presence identity from the authenticated user.

## 7. Data migration and quarantine

This is a separate release-readiness workstream, not part of Phase 2
authorization/trusted-provenance implementation or verification. Phase 2 must
fail closed on invalid legacy rows but does not inventory, migrate, backfill,
repair, or quarantine them.

Within that separate workstream:

1. Produce a read-only integrity report for every CRM relation.
2. Classify invalid rows as repairable, ambiguous, or unrecoverable.
3. Repair only relationships with a deterministic authoritative source.
4. Quarantine ambiguous rows from operational use; do not invent IDs.
5. Detect:
   - zero and missing IDs;
   - dangling relations;
   - cross-organization/company relations;
   - deleted/merged contact targets;
   - contradictory opportunity state;
   - duplicate sales orders per opportunity;
   - contact hierarchy cycles;
   - duplicate associations and stale counts;
   - forged or inconsistent identity verification metadata.
6. Record before/after counts and representative row IDs.
7. Re-run the integrity report after migration and require zero unresolved P0
   violations.

## 8. Test plan

### Backend persisted-data tests

- Create every major CRM record with distinctive non-default relation IDs.
- Query the stored row and every association after the reducer commits.
- Exercise missing, cross-organization, cross-company, unauthorized,
  inactive, archived, deleted, and incompatible references.
- Verify contact hierarchy cycle prevention.
- Verify opportunity conversion sequential and concurrent retries.
- Verify contact merge retry, complete repointing, counts, and rollback.
- Evaluate dynamic segments with at least 501 matching contacts plus deleted
  contacts.
- Verify trusted identity and provider-event reducers reject ordinary callers.

### Patch and collection tests

- Omitted scalar preserves stored value.
- Explicit null clears only nullable fields.
- Empty string follows the documented normalization/rejection rule.
- Undefined collection is unchanged.
- Empty replacement collection clears only when documented.
- Add/remove operations are unique and idempotent.
- Any invalid member rejects the entire association change.

### API, generated contract, and UI tests

- Regenerate bindings after backend contract changes.
- Test reducer JSON encoding for all three patch states.
- Verify API updates are atomic.
- Verify active-company selection cannot be replaced by form input.
- Reload list and detail views and assert relation labels and archived-state
  handling.
- Assert every affected resource refreshes after merge and association changes.

### Required verification commands

Use the repository’s current commands at implementation time. At minimum:

```text
cargo fmt --check
cargo clippy --all-targets
cargo test
SpacetimeDB runtime CRM domain tests
query-hooks tests
STDB package tests
web unit tests
frontend typecheck
targeted CRM end-to-end tests
```

Native Rust linkage tests alone are insufficient; closure requires reducers
running against persisted SpacetimeDB data.

## 9. Delivery sequence

### Phase 0 — Containment

- Disable or restrict CRM CSV imports.
- Prevent unrestricted multi-company CRM rollout.
- Add telemetry for rejected/invalid relation attempts.
- Run the integrity inventory and preserve its results.

**Status: Verified on Maincloud persisted data (2026-08-15).**

Completion evidence:
- Implementation:
  - CSV import kill switch: `api-server/src/routes/import.rs` gates `contact`/`lead`/`opportunity`
    entities in `import_entity_post` behind `LUMIERE_ENABLE_CRM_CSV_IMPORT` (default disabled,
    returns HTTP 403). Rejection telemetry via `tracing::warn!` on denial, and `log::warn!` added
    to `spacetimedb/src/data_ops/import_tracker.rs::record_import_error` for every rejected import
    row (entity/job/row/field/error).
  - Multi-company rollout restriction: `spacetimedb/src/crm/require_single_company_crm_scope`
    (`spacetimedb/src/crm/mod.rs`) rejects CRM writes targeting a non-default company for
    organizations with >1 active company, unless opted into the `crm_multi_company` feature flag
    (not granted by any plan tier). Wired into `contacts.rs::create_contact`/`update_contact`,
    `leads.rs::create_lead`, `opportunities.rs::create_opportunity`/`update_opportunity`/
    `create_opportunity_line`/`convert_opportunity_to_sale_order`, and
    `contact_identities.rs::create_contact_identity`. Single/zero-company orgs are unaffected
    (short-circuits to `Ok(())`).
  - Integrity inventory: read-only reducer `crm_integrity_inventory`
    (`spacetimedb/src/crm/integrity_inventory.rs`) checks the 9 categories in section 7 item 5
    across CRM tables and reports counts + sample IDs via `log::info!`/`log::warn!`.
- Schema/contract: No schema changes; no generated-bindings impact (server-only reducer/route logic).
- Migration/backfill: Not applicable to this phase — no data was migrated or repaired.
- Persisted positive test: Not yet run — the integrity inventory reducer has **not been executed
  against a populated database** (blocked in the implementation sandbox by database-ownership
  permissions; see `docs/integrity/crm-integrity-inventory-baseline.md` section 3 for the exact
  errors and instructions to complete the run). No violation counts exist yet.
- Isolation and negative tests: `spacetimedb` crate `cargo test` (21 unit tests + WASM-link compile
  guard) passes with all three changes merged. CRM lifecycle reducer-tests
  (`spacetimedb/tests/crm/*.rs`) compile cleanly but require `spacetime publish` + `spacetime call
  run_all_crm_tests` to execute, which was not run in this pass.
- Update/collection semantics test: Not applicable — no patch-contract changes in this phase.
- Retry/rollback test: Not applicable — no multi-record atomic commands introduced in this phase.
- Fresh read/UI test: Not applicable — Phase 0 is server-side write-path containment only; no UI
  or read-path changes.
- Generated artifacts and checks: `cargo check` and `cargo test` clean for both `spacetimedb` and
  `api-server` crates (only pre-existing, unrelated warnings). No `spacetime publish` was run.
- Reviewer: Unreviewed — implemented via subagents, verified by diff review and local
  cargo check/test only.
- Completed on: 2026-07-31

**2026-08-15 Maincloud completion evidence:**

- Added fail-closed reducer `run_crm_persisted_integrity_smoke_test`, backed by
  the same nine read-only finding collectors as `crm_integrity_inventory`.
- Published and reset Maincloud database `lumiere-v1-j1uo0` with explicit
  authorization to discard synthetic data.
- `run_all_crm_tests` passed against a persisted dataset containing 46 contacts,
  10 opportunities, and 5 opportunity lines.
- The assertive smoke reducer then passed with `count=0` for all nine categories:
  zero/missing IDs, dangling relations, cross-org/company references,
  deleted/merged targets, contradictory opportunity state, duplicate SOs,
  hierarchy cycles, duplicate/stale associations, and forged verification.
- Clean-database runtime execution exposed and fixed fixture-only assumptions
  for magic UoM/currency IDs, authenticated presence display names, and the
  required multi-company feature flag, plus a WhatsApp fixture that claimed
  verification without provider proof. Production validation was not weakened.
- After the final authorized reset, the smoke reducer passed again with all nine
  categories at zero. The populated pre-reset proof is preserved in
  `docs/integrity/crm-integrity-inventory-baseline.md`.
- Local verification: rustfmt checks, `cargo check`, `cargo test`, and
  `git diff --check` passed; only unrelated existing warnings remain.

Phase 0 is closed. The Phase 1–3 UI, large-population, and specialized semantic
gates documented below remain separate P1/P2 work.

### Phase 1 — Write safety

- CRM-RI-001 through CRM-RI-006.
- Regenerate contracts and update all callers together.
- Do not mix old and new patch semantics in one deployed version.

**Status: Implemented, unverified against real data (2026-08-01).**

Completion evidence:
- Implementation:
  - **CRM-RI-001** (`spacetimedb/src/data_ops/crm_imports.rs`): missing/malformed/zero relation
    IDs are now distinguished and rejected (literal `"0"` is treated as invalid, not a real id);
    inline scoped validation (existence, org match, active/not-merged where the target table
    tracks it) added for every relation column across all three importers; opportunity import now
    resolves and validates `company_id` via `company_id_from_scope` instead of discarding it;
    per-row all-or-nothing validation before any insert; batch keeps its existing per-row
    skip/continue-and-report behavior.
  - **CRM-RI-002**: scoped relation validation added to `contacts.rs` (parent org/active/self/cycle
    checks via new `validate_contact_parent`, company-change validation in `update_contact`),
    `leads.rs` (source/campaign/medium/partner/tags on `create_lead`; `opportunity_stage_id` on
    `convert_lead_to_customer`), and `opportunities.rs` (partner/contact/campaign/medium/source/
    lost-reason/currency/tags on `create_opportunity` and `update_opportunity`; UoM-category and
    tax compatibility on `create_opportunity_line`). `team_id` remains unvalidated everywhere — no
    scoped team table exists in the schema; tracked as a known gap, not silently skipped.
  - **CRM-RI-003**: only the lead patch contract was converted to the three-state
    `Option<Option<T>>` pattern (matching the existing precedent in
    `spacetimedb/src/accounting/chart_of_accounts.rs`), as part of building `update_lead`. Contact
    address/business/details patch semantics (the plan's original evidence file) were **not**
    touched in this pass — `update_contact_address`/`update_contact_business`/
    `update_contact_details` still take plain `Option<String>` per field, so the omitted-field-gets-
    cleared risk described in the plan remains open for contacts. Tracked as remaining work.
  - **CRM-RI-004**: new atomic `update_lead` reducer (`spacetimedb/src/crm/leads.rs`) replaces the
    three-way `update_lead_details`/`update_lead_address`/`update_lead_revenue` split for the
    `PUT /crm/leads/:id` api-server route, which now makes one reducer call instead of
    `tokio::try_join!`-ing three. **Important caveat found during verification**: the frontend does
    not currently call this route at all — `frontend/packages/query-hooks/src/hooks/crm.ts`
    (`useUpdateLeadDetails`/`useUpdateLeadAddress`/`useUpdateLeadRevenue`) calls the three old
    reducers directly via a separate generic reducer-call passthrough, bypassing this route
    entirely. The three old reducers were deliberately kept (not removed) because of this live
    caller. **The atomicity fix is implemented but not yet reachable from the product UI** — either
    the frontend needs to be switched to call `update_lead`, or the real non-atomic path (whatever
    UI component invokes those three hooks together, if any) needs to be identified and fixed
    separately. This is the single biggest gap in this phase's closure.
  - **CRM-RI-005**: `convert_opportunity_to_sale_order` now checks for an existing `sale_order`
    with the same `opportunity_id` first and returns `Ok(())` as a no-op retry if found; won-stage
    selection now errors on more than one `is_won` stage per organization instead of silently
    picking the first match; all validation (partner, product/UoM, won-stage resolution) happens
    before any mutation (customer-flag update, sale order creation, opportunity update).
  - **CRM-RI-006** (`spacetimedb/src/crm/duplicate.rs`): `merge_contacts` now rejects merges that
    would create a contact hierarchy cycle (new `would_create_contact_cycle`, bounded ancestor-chain
    walk) before any writes; added repointing for `contact_phone_identity` (dedup on kind/company/
    normalized number, preferred-flag demotion), `contact_role_assignment` (dedup active roles
    only), `crm_conversation` (plain repoint), and `contact_relationship_insight` (repoints both the
    owning contact and `related_contact_ids` occurrences); recomputes `contact_segment.member_count`
    for segments touched by the dedup-and-delete path; extended the existing audit log call with
    per-category repoint counts instead of adding a second audit call.
- Schema/contract: No table schema changes. New reducer `update_lead` and params type
  `UpdateLeadParams` added; existing reducer signatures otherwise unchanged. Generated bindings
  (`spacetime generate`) were not regenerated at the time — recorded then as a sandbox
  publish-permission limitation, but that premise was false and the bindings have since been
  regenerated (2026-08-02; see the correction note at the end of Phase 3).
- Migration/backfill: Not performed. Existing invalid CRM relation data (if any) has not been
  audited or repaired — the integrity inventory reducer built in Phase 0 has not yet been run
  against real data, so it is unknown whether pre-existing rows would fail the new validation.
- Persisted positive test: Not run — no `spacetime publish`/`spacetime call` was possible in this
  sandbox (known database-ownership permission limitation, documented in Phase 0's evidence).
- Isolation and negative tests: `spacetimedb` crate `cargo test` (21 unit tests + WASM-link compile
  guard) passes with all five changes merged. CRM reducer-style tests under `spacetimedb/tests/crm/`
  compile but require `spacetime call run_all_crm_tests` to actually execute, which was not run.
- Update/collection semantics test: Not run (requires a live database). Reviewed by inline diff
  read: `update_lead`'s field-application logic correctly mirrors the `chart_of_accounts.rs`
  precedent for `Option<Option<T>>` unwrapping.
- Retry/rollback test: Not run against a live database. Reviewed by inline diff read: idempotency
  and validate-before-mutate ordering in `convert_opportunity_to_sale_order`, and validate-before-
  write ordering in `merge_contacts`'s cycle check, are structurally correct.
- Fresh read/UI test: Not applicable/not run — no UI or read-path changes in this phase, and no live
  environment available to verify server behavior end-to-end.
- Generated artifacts and checks: `cargo check`, `cargo test`, `cargo clippy --all-targets`, and
  `cargo fmt --check` (scoped to the files this phase touched — the repository has substantial
  pre-existing, unrelated formatting drift across many other files that was not introduced by and
  is out of scope for this work) all pass clean for both the `spacetimedb` and `api-server` crates.
- Reviewer: Unreviewed — implemented via five parallel subagents (one per file-scoped work item),
  merged and verified by diff review plus local cargo check/test/clippy/fmt only.
- Completed on: 2026-08-01

### CRM-RI-004 dead-route gap — resolved (2026-08-01)

Investigation found the real live caller: `frontend/web/app/(modules)/crm/crm-client.tsx`'s three
"Edit Lead Details/Address/Revenue" modals call `useUpdateLeadDetails`/`useUpdateLeadAddress`/
`useUpdateLeadRevenue` (`frontend/packages/query-hooks/src/hooks/crm.ts`) directly via the generic
`/api/call/:reducer` passthrough — not the `PUT /crm/leads/:id` REST route this phase's `update_lead`
work originally targeted. Tracing the wire format confirmed a live, reproducible instance of
CRM-RI-003: `stdbParamsToJson(params, "UpdateLeadDetailsParams")` force-fills every `Option` field
absent from the submitted patch with an explicit `{none: []}` tag
(`frontend/packages/stdb/src/stdb-params-json.ts:365-372`), and the old reducers
(`update_lead_details`/`update_lead_address`/`update_lead_revenue`) directly overwrite every field
with `params.field` (`spacetimedb/src/crm/leads.rs`) — so editing only `title` in the "Edit Lead
Details" modal silently cleared `contactName`/`website`/`industry`/`referredBy`/`description`.

Fix: added `useUpdateLead` (`frontend/packages/query-hooks/src/hooks/crm.ts`) and a hand-declared
`UpdateLeadParams` patch type (`frontend/packages/query-hooks/src/hooks/crm-params-merge.ts`,
not sourced from generated bindings — see note below), calling `stdbParamsToJson` **without** a
`structName`, mirroring the working `useUpdateAccountGroup` precedent
(omitted key → unchanged, explicit `null` → clear, value → replace). Wired all three lead-edit
modals in `crm-client.tsx` to this one hook; the three old reducers/hooks are kept (marked
`@deprecated`) since they're still registered server-side and removing them would require a
`spacetime generate` pass this sandbox cannot perform. Updated `CRM_UI_REDUCERS`
(`frontend/web/lib/crm-ui-reducers.ts`) to reflect `update_lead` as the actually-reachable reducer.
Added regression tests in `crm-params-merge.test.ts` covering the omit/null/value distinction.
Verified: `frontend/packages/query-hooks` and `frontend/packages/stdb` typecheck clean; `frontend/web`
typecheck has the same 66 pre-existing errors as before this change (confirmed via `git stash`
diff — none introduced by this fix); all CRM-related unit tests pass
(`crm-params-merge.test.ts`, `crm-update-params.test.ts`).

### CRM-RI-003 extended to contacts — resolved (2026-08-01)

`update_contact_address`/`update_contact_business`/`update_contact_details`
(`spacetimedb/src/crm/contacts.rs`) had the identical bug as leads: single-level
`Option<T>` fields with "`None` = clear" semantics, blindly overwritten on every call —
so editing one address field cleared every other address field on the same contact.
Fixed the same way as leads (two parallel subagents, one per side, since the wire
contract could be fully specified upfront and the files don't overlap):

- **Backend**: `UpdateContactAddressParams`, `UpdateContactBusinessParams`,
  `UpdateContactDetailsParams` fields all converted to `Option<Option<T>>`
  (including `employees_count`/`annual_revenue`, which are genuinely clearable
  optional facts, unlike a lead's always-present revenue/probability). All three
  reducers now resolve each field via `params.field.unwrap_or(contact.field)` /
  `unwrap_or_else(|| contact.field.clone())` before validation and before the
  final `.update()` call, mirroring `update_lead`/`chart_of_accounts.rs` exactly.
  Contacts keep three separate reducers (no CRM-RI-004-style consolidation —
  that was leads-API-specific).
- **Frontend**: hand-declared `UpdateContactAddressParams`/`UpdateContactBusinessParams`/
  `UpdateContactDetailsParams` interfaces added to `crm-params-merge.ts` (same
  "not from generated bindings" caveat as `UpdateLeadParams`); the three
  `useUpdateContactAddress`/`Business`/`Details` hooks in `crm.ts` now call
  `stdbParamsToJson` **without** a `structName` (the actual fix, identical to
  `useUpdateLead`); `crm-update-params.ts`'s three mapper functions retargeted to
  the new types with no logic changes; `crm-client.tsx` required no changes
  (hook names/call sites unchanged, only the underlying patch semantics fixed).
  Added 6 regression tests to `crm-params-merge.test.ts` (omit-preserves and
  explicit-null-clears, one pair per contact patch function).

Verified: `spacetimedb` and `api-server` crates — `cargo check`/`cargo test` clean
(21 + 1 tests passing). `frontend/packages/query-hooks` — 22/22 unit tests pass,
`tsc --noEmit` clean. `frontend/packages/stdb` — `tsc --noEmit` clean. `frontend/web`
— `tsc --noEmit` has the same 66 pre-existing errors as the baseline (byte-identical
error list, confirmed line-by-line; zero introduced by this change);
`crm-update-params.test.ts` (9/9) passes.

**Outstanding before Phase 1 can be marked Verified:**
1. Run the Phase 0 integrity inventory against real data, backfill/quarantine per section 7, then
   run the full persisted-data positive/negative/retry test matrix from section 8 against a live
   SpacetimeDB instance.
2. ~~Regenerate client bindings once publish access is available.~~ **Done
   2026-08-02.** The premise was false — `spacetime generate` never needed publish
   access (see the correction note at the end of Phase 3). `UpdateLeadParams` and
   the three `UpdateContact*Params` hand-declared TS types have been replaced with
   generated ones.
3. Reviewer sign-off.

### Phase 2 — Authorization and trusted provenance

- CRM-RI-007, CRM-RI-008, and CRM-RI-010.
- Validate authenticated BFF HTTP reads and the authenticated api-server
  WebSocket invalidation/subscription bridge with two organizations and at
  least two companies in organization A.
- Existing-data inventory, migration, backfill, repair, and quarantine are
  explicitly outside this phase. They remain a separate release-readiness
  workstream under section 7 and are not Phase 2 completion gates. Phase 2
  persisted tests seed new, intentionally scoped fixture data.

**Persisted boundary acceptance matrix:**

1. Publish a fresh fixture with `org-a/company-a1`, `org-a/company-a2`, and
   `org-b/company-b1`; create one ordinary user bound to each company and seed
   distinctive `A1_ONLY`, `A2_ONLY`, and `B1_ONLY` rows for every CRM resource.
   Seed `ORG_A_SHARED` only for resources explicitly classified as shared.
2. For each user, query every CRM resource through authenticated BFF HTTP. A1
   must receive exactly A1 plus documented org-A-shared IDs, A2 exactly A2 plus
   those shared IDs, and B1 exactly B1 IDs.
3. Using each ordinary user's SpacetimeDB token, attempt direct SQL/generated-
   table reads and subscriptions for every private CRM base table. Every attempt
   must be rejected at the server boundary and must deliver zero rows; a client-
   side filter, empty initial render, or later projection removal is not proof.
4. Connect each user to the authenticated API WebSocket bridge, mutate one
   distinctive row per CRM resource/company through an authorized reducer, and
   assert that only eligible resource/company subscriptions receive a change
   signal. Assert that the signal contains no private row payload, requery BFF
   HTTP, and compare exact expected IDs. Repeat after WebSocket reconnect and
   browser reload.
5. Attempt BFF and WebSocket requests with a sibling-company ID and another
   organization's ID. Both must return an authorization error and create no
   subscription. Persist the exact request, identity, expected IDs, actual IDs,
   rejection, and reconnect/reload result as release evidence.

**Status: Implemented; the persisted contact boundary is verified against a live
multi-tenant BFF/WebSocket run, while the all-CRM-resource matrix remains unverified
(2026-08-01).**

Completion evidence:
- Implementation:
  - **CRM-RI-007:** `api-server/src/query_exec.rs` derives one permitted CRM company from
    the authenticated active `user_organization` membership (company-bound membership uses that
    company; an unscoped membership is restricted to the server default company) and filters
    company-bearing resources directly plus opportunity/contact/conversation children through
    their visible parents. `api-server/src/http_app.rs` accepts browser `companyId` as intent and
    validates it against that server-derived scope. `api-server/src/realtime/mod.rs` validates
    requested company IDs, applies the validated active company only to CRM subscriptions, and
    retains existing multi-company behavior for non-CRM resources. Query keys and HTTP/WS requests
    now carry the active company in `frontend/packages/query-hooks/src/hooks/stdb.ts`,
    `frontend/packages/query-hooks/src/hooks/realtime.ts`, and `frontend/web/app/providers.tsx`.
    Subscription builders and projections scope direct company rows, fail closed for an
    absent/ambiguous company, and omit child rows whose company can only be resolved through a
    parent (`frontend/packages/stdb/src/queries/erp-subscriptions.ts`,
    `frontend/packages/stdb/src/live/projection.ts`, and
    `frontend/packages/stdb/src/subscriptions/crm-workspace.ts`). These are defense-in-depth only:
    the SpacetimeDB 2.0 boundary is private CRM base tables read by the authenticated BFF with the
    server owner token after session/company authorization. The authenticated api-server WebSocket
    bridge uses the owner token only after validating caller organization/company scope and emits
    change/invalidation signals so clients requery the BFF; it does not expose CRM row payloads.
    Rows intentionally classified as organization-shared must be documented in policy rather than
    inferred from a nullable company field.
  - **CRM-RI-008 identity:** `spacetimedb/src/crm/contact_identities.rs` derives company from the
    loaded active contact, rejects an explicit mismatch, rejects caller-selected verification
    state on create/update, persists new identities as unverified, resets verification when the
    normalized number changes, and makes the dedicated verify reducer own the verified state and
    timestamp behind `contact_identity:verify`. Existing identity/contact company mismatches fail
    closed on update, verify, and archive. The UI no longer edits/submits verification state in
    `frontend/packages/ui/src/lib/crm-form-configs.ts`,
    `frontend/web/app/(modules)/crm/contact-identities-panel.tsx`, and
    `frontend/web/lib/crm-coverage-create-params.ts`.
    The permission-only verifier is now disabled. A private immutable
    `contact_identity_verification_proof` binds trusted OTP/provider evidence to the exact
    organization, company, contact, identity, and current normalized number. Only the exact
    principal in the private `contact_identity_verification_authority` singleton may record proof;
    configuration requires the active global server superuser and rotation also requires the
    current issuer. Proofs accept only a SHA-256 evidence digest (never raw OTP/callback data), a
    live validity window of at most fifteen minutes, and a provider idempotency reference. Exact
    callback retries are idempotent; conflicting reuse, expired/future/stale-number proof, archived
    or opted-out identities, and ordinary CRM callers fail closed. The UI no longer exposes manual
    verification. The full boundary is documented in
    `docs/integrity/crm-identity-verification-contract.md`.
  - **CRM-RI-008 provider provenance and CRM-RI-010:** `spacetimedb/src/crm/inbox.rs` requires an
    active compatible WhatsApp/SMS identity whose organization/contact/company matches the active
    contact; validates an assignee's active profile and exact organization/company membership;
    revalidates lifecycle on append/update; and reuses a conversation only when contact, channel,
    identity, external thread, and assignee intent match. Ordinary callers may persist only
    outbound draft/queued intent. Inbound/received/sent/delivered/provider IDs, operational-message
    linkage, and external provider thread IDs fail closed because no trusted provider principal is
    configured. `frontend/web/app/(modules)/crm/crm-inbox-panel.tsx` now supplies a compatible
    preferred identity instead of opening an identity-less thread.
- Schema/contract: Legacy optional verification/provider fields remain for binding compatibility
  but unsafe values are rejected. Identity proof adds private authority/evidence tables and a
  trusted `record_contact_identity_verification_proof` reducer; the legacy verify reducer remains
  callable only to return a proof-required error. CRM base-table visibility
  changed from public to private, the BFF query contract gained optional `companyId`, and realtime
  subscribe messages gained optional `activeCompanyId`. Generated Rust bindings were refreshed.
  The targeted live contact BFF/WebSocket and direct-SQL rejection path passes; the equivalent
  direct-access and live matrix for every private CRM table remains required for full verification.
- Migration/backfill: Out of scope for Phase 2. This phase neither migrates nor classifies existing
  shared/null-company rows, mismatched identity scopes, forged verification metadata, or
  incompatible conversations, and no such work is required to complete the Phase 2 gates.
- Persisted positive test: `make e2e-single-test
  E2E_STDB_MODULE=lumiere-v1-crm-isolation-b92c4
  E2E_SPEC=crm-read-isolation.spec.ts E2E_GREP= E2E_WORKERS=1` passed against a published local
  SpacetimeDB database (2/2 Playwright tests). The fixture created two organizations, two companies
  in each organization, company-distinct contacts, and a company-bound ordinary member. Exact BFF
  contact sets survived mutation, requery, reload, and WebSocket reconnect. This is targeted
  CRM-RI-007 evidence, not execution of every CRM runtime test reducer.
- Isolation and negative tests: Added CRM runtime cases for cross-company identity rejection,
  caller-forged verification create/update, omitted-company derivation, verification reset after a
  number change, missing/mismatched inbox identity, forged provider state/thread/linkage, exact
  conversation retry reuse, and no message row after rejection. Added STDB SQL/projection tests for
  one-company scope, explicit shared rows, ambiguous scope, and parent-owned fail-closed behavior.
  The persisted contact slice of the A1/A2/B1 BFF/WebSocket matrix now passes: sibling-company and
  cross-organization BFF and bridge requests are rejected, an ordinary token's direct `contact`
  SQL read is rejected, eligible subscriptions receive invalidations without row payloads, and the
  BFF result remains scoped after reconnect/reload. The every-resource/every-private-table matrix
  remains unrun. SpacetimeDB 2.0 subscription SQL cannot compare its algebraic `Option<u64>` company
  column to a numeric literal or `IS NULL`. The owner-only bridge therefore applies company scope in
  generated typed row callbacks: direct company-bearing CRM changes emit an invalidation only when
  the row company matches the validated company, while explicit null-company shared rows notify all
  eligible companies. Parent-scoped child resources without their own company column still require
  all-resource live coverage and, where necessary, a schema-level ownership key.
- Update/collection semantics test: Identity number updates reset verification as designed; inbox
  update clear semantics remain assigned to CRM-RI-012 in Phase 3. No collection contract changed.
- Retry/rollback test: Local reducer test code asserts exact conversation-open retry reuse and no
  message row after rejected provider input; live transactional execution remains unverified.
- Fresh read/UI test: The targeted Playwright contact test passed its WebSocket-triggered BFF
  requery, browser reload, and reconnect assertions against the persisted two-organization fixture.
  Equivalent coverage for the remaining CRM resources is still outstanding.
- Generated artifacts and checks:
  - `spacetimedb`: `cargo test` passed (23 unit tests plus the WASM-link guard; pre-existing warnings).
  - `frontend/packages/stdb`: 39/39 tests passed; `pnpm typecheck` passed.
  - `frontend/packages/query-hooks`: 39/39 tests passed; `pnpm typecheck` passed.
  - `frontend/packages/ui`: `pnpm typecheck` passed.
  - `frontend/web`: typecheck still reports the same broad pre-existing generated-contract errors
    in accounting/CRM/HR/projects/sales surfaces; no error points to the Phase 2 identity/inbox or
    provider plumbing files after the subscription helper integration fix.
  - `api-server`: targeted `cargo test --lib query_exec::tests::` passed (5/5; pre-existing
    warnings), including the final mixed CRM/non-CRM WebSocket refinement compilation. The focused
    `realtime::tests::owner_subscription_uses_full_rows_and_retains_scope` test also passed; this
    protects the SpacetimeDB 2.0 requirement that subscriptions return a complete table row while
    the bridge emits invalidations only.
  - `git diff --check` passed.
- Reviewer: Unreviewed — implemented with three scoped subagents and integrated/diff-reviewed by
  the root agent.
- Completed on: 2026-08-01

**Outstanding before Phase 2 can be marked Verified:**
1. Extend the passing published contact fixture to every CRM resource/ownership class and ordinary
   company-bound caller. For each resource, assert exact authenticated BFF IDs, scoped mutation and
   WebSocket invalidation behavior, no sibling-company/cross-organization IDs or private row
   payloads, and the same result after reconnect/reload.
2. Add a real trusted provider principal/callback contract before supporting inbound messages,
   delivery facts, provider IDs, external threads, or operational-message linkage. Do not reopen
   these fields to ordinary CRM writers.
3. Provision `contact_identity_verification_authority` with the production server/provider adapter
   identity and implement authenticated OTP delivery/provider callback handling. The private proof
   artifact and trusted reducer contract are implemented; the repository has no delivery adapter,
   so user-facing verification intentionally remains unavailable.
4. Extend the passing ordinary-token direct `contact` SQL denial and the static all-CRM-private
   invariant to a live direct query and direct subscription rejection for each private CRM base
   table. This is a server boundary test, not a frontend SQL/projection test.
5. Obtain reviewer sign-off.

### Phase 3 — Semantic completion

- CRM-RI-009 and CRM-RI-011 through CRM-RI-017.
- Recompute derived data and association counts after migration.

**Status: Implemented, unverified against real data (2026-08-02).**

Completion evidence:
- Implementation:
  - **CRM-RI-009** (`spacetimedb/src/crm/segments.rs`): removed the
    `MAX_SEGMENT_EVAL_CONTACTS = 500` cap and its `.take(...)` from
    `evaluate_dynamic_segment`. The cap was not merely truncating: contacts past
    #500 were never matched, and the "deactivate members no longer matching" loop
    then **actively deactivated their existing valid memberships**. Evaluation now
    scans the full `contact_by_org` population, excludes contacts with
    `deleted_at.is_some()` or `merge_target_id.is_some()`, and additionally
    deactivates member rows whose contact is deleted/merged/missing. Added index
    `segment_member_by_segment` on `SegmentMember(segment_id)`, replacing two
    full-table `.iter()` scans (one of which was per-matched-contact, i.e.
    quadratic). `matched_ids` is now a `HashSet` and existing members are read once
    into a `HashMap` keyed by `contact_id`. `member_count` is recomputed by counting
    persisted active rows through the new index, never by an incremented counter.
  - **CRM-RI-011** (`spacetimedb/src/crm/opportunities.rs`): added a non-table
    `OpportunityState { Open, Won, Lost }` enum plus `validate_transition` and
    `resolve_target_state`. The `is_won`/`is_lost` columns are retained for binding
    compatibility, but every write path resolves through the enum, so
    `(true, true)` can no longer be written. Allowed edges: no-op, `Open→Won`,
    `Open→Lost`, `Won→Open`, `Lost→Open`; `Won→Lost` and `Lost→Won` are rejected
    (reopen first). The target stage's `is_won` flag is authoritative for the Won
    axis: a won stage forces `Won` even with no explicit request, and a non-won
    stage never permits `Won`. **The `stage.name == "Lost"` string check called out
    in the audit is removed.** `date_closed` is server-derived on an actual
    transition; `lost_reason_id` is required and validated for `Lost`, and rejected
    outside it.
  - **CRM-RI-012**: nullable relations converted to the three-state
    `Option<Option<T>>` contract (absent = unchanged, `Some(None)` = clear,
    `Some(Some(v))` = replace), following the `update_lead` /
    `chart_of_accounts.rs` precedent. Applied to `UpdateOpportunityParams`
    (`partner_id`, `contact_id`, `date_deadline`, `date_closed`, `lost_reason_id`,
    `description`), `AssignContactRoleParams` (`active_until`, `metadata` — the
    previous `.or(existing)` merge made `active_until` structurally unclearable),
    and `UpdateCrmConversationParams` (`assigned_user_id`, `metadata`).
    `external_thread_id` was deliberately **not** widened: it is provider-owned, and
    a `Some(None)` would have let an ordinary caller sever provider thread linkage,
    reopening the CRM-RI-008/010 guard. Non-nullable columns stay single-level.
  - **CRM-RI-013** (`frontend/packages/query-hooks/src/hooks/crm.ts`): the merge
    mutation invalidated only `contacts` + `leads` while the Phase-1-hardened
    `merge_contacts` reducer also repoints phone identities, role assignments,
    conversations, and relationship insights, and recomputes
    `contact_segment.member_count`. Invalidation extended from 2 to 11 resources.
  - **CRM-RI-014** (`spacetimedb/src/crm/contacts.rs`): implemented the previously
    dead category surface — scoped `create`/`update`/`archive` for
    `ContactCategory` (with a cycle-checking parent validator), plus §4.4
    `add`/`remove`/`replace`/`clear` assignment reducers that deduplicate and
    validate every ID before any write and reject the whole batch on any invalid
    member. Removal deliberately not chosen: it is a schema migration requiring a
    binding regeneration this environment cannot perform.
  - **CRM-RI-015** (`spacetimedb/src/crm/activities.rs`): introduced
    `CrmActivityTarget { Contact(u64), Lead(u64), Opportunity(u64) }` replacing the
    caller-supplied `res_model`/`res_id` pair in the params. Each variant resolves
    through a scoped loader (exists → organization match → lifecycle). The
    `res_model`/`res_id` columns are retained but are now derived exclusively from
    the validated target, never caller text. An absent target remains valid.
  - **CRM-RI-016** (`spacetimedb/src/crm/lead_scoring.rs`,
    `relationship_intel.rs`): chose the plan's "visible snapshot freshness" option
    over a partial event-driven engine. Added `is_stale`/`stale_since` to
    `LeadScore` and `ContactRelationshipInsight`, plus `mark_lead_score_stale` /
    `mark_relationship_insight_stale`. **Call sites were wired, not just exposed** —
    four in `leads.rs` (the update reducers feeding `compute_factors`) and three in
    `contacts.rs` (`create_contact_relationship` and `end_contact_relationship`
    marking *both* endpoints; `update_contact_parent` marking the contact plus old
    and new parent). Without these the helpers were dead code and the acceptance
    gate was not met.
  - **CRM-RI-017** (`spacetimedb/src/crm/presence.rs`): removed the caller-supplied
    `user_name` parameter; the display name is derived from `user_profile` via
    `ctx.sender()` and fails closed when no profile exists. Added
    `check_permission(... "opportunity", "read")` and
    `require_single_company_crm_scope` — the reducer previously claimed to check
    organization membership but did not.
- Schema/contract: `SegmentMember` gained the `segment_member_by_segment` index;
  `LeadScore` and `ContactRelationshipInsight` gained `is_stale`/`stale_since`;
  `ContactCategory`/`ContactCategoryAssignment` gained reducers. Wire contracts
  changed for `UpdateOpportunityParams` (new `desired_state`, six triple-state
  fields), `AssignContactRoleParams`, `UpdateCrmConversationParams`,
  `CreateActivityParams` (new `target`), and `update_opportunity_presence`
  (parameter removed).
  **Generated bindings WERE regenerated (2026-08-02).** See the correction note
  below: `spacetime generate` never required publish access. `make
  generate-stdb-ts-sdk` and `make codegen` both completed successfully, and every
  hand-declared TS stand-in from Phases 1–3 has been deleted in favour of the
  generated types. Regeneration immediately exposed three real call sites that
  the hand-declared types had been masking, all now fixed:
  `crm-params-merge.ts::finalizeCreateActivityParams` and
  `packages/ui/src/crm-components/crm-record-chatter.tsx` were still building the
  removed `resModel`/`resId` pair, and `web/lib/crm-create-params.ts` carried the
  masking type. The chatter is mounted on records outside the
  `CrmActivityTarget` enum (including `activity` itself), so an unsupported model
  now maps to `undefined` — a legitimately unattached activity — instead of a
  value the server would reject.
- Migration/backfill: Not performed and explicitly out of scope. No existing rows
  were migrated, translated, or quarantined — including legacy activity rows with
  unknown `res_model` values and pre-existing contradictory opportunity states.
  All changes fail closed on NEW writes only. This remains the separate section 7
  workstream.
- Persisted positive test: **Not run.** No `spacetime publish` / `spacetime call`
  against a populated database was performed. `spacetime build` succeeded, proving
  the module compiles to valid WASM and the schema is accepted, but that is not
  persisted-data evidence.
- Isolation and negative tests: Not run against live data. The `spacetimedb` crate
  suite (24 unit tests + WASM-link guard) passes, including
  `crm::privacy_tests::all_crm_storage_tables_are_private`, confirming Phase 2's
  privacy invariant was not regressed by the new category reducers.
- Update/collection semantics test: Not run against live data. The category
  assignment ops implement add/remove/replace/clear per §4.4, but the persisted
  omit/null/value matrix from section 8 remains unexecuted.
- Retry/rollback test: Not run. Validate-before-write ordering was confirmed by
  diff review only.
- Fresh read/UI test: Not run. CRM-RI-013's invalidation set is covered by a
  source-extraction regression test that was mutation-verified (removing one
  invalidation produces two accurate failures), but no live UI refresh was observed.
- Generated artifacts and checks:
  - `spacetimedb`: `cargo check` clean (0 errors); `cargo test` 24 + 1 passing;
    `spacetime build` finished successfully.
  - `frontend/packages/query-hooks`: 42/42 tests, typecheck clean.
  - `frontend/packages/stdb`: 37/37 tests, typecheck clean.
  - `frontend/packages/ui`: typecheck clean.
  - `frontend/web`: typecheck at the unchanged 66-error pre-existing baseline;
    zero new errors introduced.
- Reviewer: Unreviewed — implemented via scoped subagents, integrated and
  diff-reviewed by the root agent.
- Completed on: 2026-08-02

**Outstanding before Phase 3 can be marked Verified:**
1. ~~Regenerate client bindings.~~ **Done 2026-08-02** — see the correction note
   below. All hand-declared types replaced with generated ones; stdb,
   query-hooks, and ui typecheck at 0 errors, web at its unchanged 66-error
   pre-existing baseline.
2. Run the section 8 persisted-data matrix against a live database — in particular
   a dynamic segment with 501+ matching contacts plus deleted contacts
   (CRM-RI-009's actual acceptance gate), and the opportunity transition matrix
   including the rejected `Won↔Lost` edges.
3. Verify CRM-RI-016 staleness end to end: mutate each source field and assert the
   projection is marked stale, then assert recompute clears it. Only the wiring is
   proven so far, not the behavior.
4. Build the CRM-RI-014 frontend surface. The backend reducer contract now exists,
   but the acceptance gate requires schema, reducers, subscriptions, and UI to
   agree on one model — no category UI or subscription wiring exists yet.
5. Reviewer sign-off.

**CORRECTION — binding regeneration was never blocked (established 2026-08-02):**
Phases 0, 1, and 2 all record that `spacetime generate` could not be run because
of "sandbox publish-permission limitations", and Phase 3 initially repeated that
claim. **This was wrong, and it was wrong for every prior phase too.**
`spacetime generate` takes `--module-path`, builds the module locally, and emits
bindings; it needs no server, no publish rights, and no authentication. The
repository already exposes both steps as Make targets:

```text
make generate-stdb-ts-sdk   # spacetime generate --include-private --lang typescript --module-path
make codegen                # cargo run -p lumiere-codegen
```

Both completed successfully on the first attempt. The consequence is that the
hand-declared TS types introduced in Phase 1 (`UpdateLeadParams`, the three
`UpdateContact*Params`) and Phase 3 were unnecessary workarounds for a
non-existent constraint — and worse, they actively MASKED real breakage: three
call sites still using the removed `res_model`/`res_id` contract only surfaced
once real generated types replaced them. Hand-declaring a type to stand in for a
generated one suppresses exactly the errors the generated type exists to raise.

Note that `spacetime publish` and `spacetime call` are genuinely unavailable
here — running reducers against a populated database still requires a database
this environment cannot provision. The persisted-data gates in every phase
remain legitimately open. Only the *code generation* claim was false.

**Note on index accessor uniqueness (investigated 2026-08-02):** the repository
guidance in `CLAUDE.md` states index names must be unique module-wide. That is
**not enforced by SpacetimeDB 2.0.1** — `spacetime build` succeeds with 11
duplicate index accessor names present across unrelated modules (`task_by_state`,
`task_by_org`, `stage_by_org`, `session_by_user`, `rule_by_org`,
`move_line_by_move`, `move_by_state`, `move_by_date`, `forecast_by_org`,
`forecast_by_company`, `allocation_by_org`). Index accessors appear to be
per-table scoped in 2.0.1. The `category_by_org` collision between
`crm/contacts.rs` and `inventory/product_category.rs` was renamed to
`product_category_by_org` on the inventory side before this was established; the
rename is harmless but was not required. The remaining duplicates were left
alone. `CLAUDE.md` should be corrected.

### Phase 4 — Release proof

- Execute the full persisted-data, negative, retry, API, UI, and refresh suite.
- Attach evidence to every item.
- Re-audit the complete data path before changing readiness.

## 10. Release gates

| Gate | Requirement | Current result | Required evidence |
|---|---|---|---|
| Schema | Important relations and uniqueness rules are represented | Fail | Final schema plus migration verification |
| Provenance | Every mutation field has one justified source | Fail | Complete CRM provenance matrix |
| Scope | Organization/company/permission/lifecycle checks are server-enforced | Fail | Persisted isolation test matrix |
| Semantics | Create, update, clear, and collection behavior are explicit | Fail | Direct, API, mapper, and UI patch tests |
| Read path | Relations resolve under the same access policy after refresh | Fail | Fresh read and UI evidence |
| Atomicity | Multi-record actions and retries are safe | Fail | Rollback and retry tests |
| Tests | Positive and negative persisted-data cases pass | Fail | SpacetimeDB runtime CRM suite |
| Contracts | Generated and frontend contracts match reducers | Fail | Clean generation diff, typecheck, and mapper tests |

Any failed or unverified P0 gate blocks production. Material P1 failures block
an unrestricted pilot. The final readiness decision must be one of:

```text
Production ready
Pilot ready with restrictions
Partially relational
Compiler-complete but semantically incomplete
Unsafe for real ERP data
```

The readiness status may change only after the tracker and release gates contain
reviewable completion evidence.
