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
- [ ] Existing invalid data is backfilled, quarantined, or rejected before
      stricter contracts are enabled.

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
| CRM-RI-001 | P0 | CSV imports persist raw or zero relation IDs | Stage, validate, and atomically promote imported rows through scoped loaders | Quarantine dangling, zero, cross-org, and cross-company IDs | Invalid imports persist nothing; valid distinctive relations survive reload | Not started |
| CRM-RI-002 | P0 | Core reducers trust contact, lead, opportunity, and line relation IDs | Apply relation-specific loaders to every create/update/conversion path | Audit and repair existing invalid relations | Full negative relation matrix passes | Not started |
| CRM-RI-003 | P0 | Partial updates can clear omitted sibling fields | Introduce explicit unchanged/clear/replace contracts end to end | None unless historical clearing damage is recoverable | Omission preserves; explicit clear clears only the requested field | Not started |
| CRM-RI-004 | P0 | Legacy lead API performs independent partial commits | Replace concurrent reducer calls with one atomic command | None | Forced sub-operation failure rolls back the entire update | Not started |
| CRM-RI-005 | P0 | Opportunity conversion can create duplicate sales orders | Add conversion idempotency and unique opportunity linkage | Detect and quarantine duplicate opportunity orders | Repeated/concurrent retries produce one sales order | Not started |
| CRM-RI-006 | P0 | Contact merge can create cycles and leave stale dependents | Validate hierarchy and repoint every dependent relation atomically | Repair self/cyclic parents and retired-contact links | Merge preserves an acyclic graph and no live dependency targets the source | Not started |
| CRM-RI-007 | P0 | CRM reads are organization-scoped despite company-bearing rows | Define and enforce company visibility on server reads and live projections | Review shared/global CRM rows before policy rollout | Company A cannot read company B data unless policy explicitly permits it | Not started |
| CRM-RI-008 | P0 | Identity verification and provider provenance are caller-controlled | Move authoritative state to trusted reducers and validate contact/company equality | Review forged verification/provider states | Ordinary CRM writers cannot forge verified or inbound/provider state | Not started |
| CRM-RI-009 | P1 | Segment evaluation truncates at 500 and deactivates valid members | Evaluate the full scoped population with pagination/indexes | Recompute all dynamic memberships and counts | More than 500 contacts evaluate correctly, excluding deleted contacts | Not started |
| CRM-RI-010 | P1 | Inbox assignment, reuse, identity, and message relations are weak | Validate membership/lifecycle/company and make reuse intent-complete | Review open conversations with mismatched identities/assignees | Invalid assignments and identities fail atomically | Not started |
| CRM-RI-011 | P1 | Opportunity lifecycle flags can contradict each other | Replace independent flags and string stage checks with validated transitions | Normalize contradictory states | Impossible state combinations are rejected or unrepresentable | Not started |
| CRM-RI-012 | P1 | Several optional relations cannot be cleared | Apply explicit patch semantics to opportunity, contact roles, and conversations | None | Each nullable relation has verified unchanged/set/clear tests | Not started |
| CRM-RI-013 | P1 | Merge/tag/segment mutations under-invalidate queries | Invalidate every changed base, association, projection, and count resource | None | Fresh UI shows all changes without broad manual reload | Not started |
| CRM-RI-014 | P2 | Category relations are defined but operationally unused | Implement scoped CRUD/assignment or remove the unused surface | Preserve or remove existing rows deliberately | Schema, reducers, subscriptions, and UI agree on one supported model | Not started |
| CRM-RI-015 | P2 | Activities use unvalidated string plus ID references | Introduce a typed CRM activity target and scoped resolution | Translate or quarantine unknown legacy references | Unsupported model/ID pairs cannot persist | Not started |
| CRM-RI-016 | P2 | Scores and relationship insights can become stale | Define event-driven recomputation or visible snapshot freshness | Recompute stale projections | Mutating source data produces or schedules a verified refresh | Not started |
| CRM-RI-017 | P2 | Presence accepts caller-provided display identity | Derive identity from authentication and verify opportunity access | None | A user cannot impersonate another presence label | Not started |

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
- Enforce that policy in reducers, API queries, subscriptions, projections,
  selectors, exports, and reports.
- Require identity company to match the contact unless a documented shared
  identity model is introduced.
- Make verification transitions proof-bearing and server-owned.
- Separate user send intent from provider receive/delivery callbacks.

**Acceptance criteria**

- Company A/A2 and organization A/B isolation tests cover every CRM resource.
- UI filtering and backend authorization return the same permitted set.
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

Before enabling strict validation:

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

### Phase 1 — Write safety

- CRM-RI-001 through CRM-RI-006.
- Regenerate contracts and update all callers together.
- Do not mix old and new patch semantics in one deployed version.

### Phase 2 — Authorization and trusted provenance

- CRM-RI-007, CRM-RI-008, and CRM-RI-010.
- Validate server and live-subscription behavior with two organizations and two
  companies.

### Phase 3 — Semantic completion

- CRM-RI-009 and CRM-RI-011 through CRM-RI-017.
- Recompute derived data and association counts after migration.

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
