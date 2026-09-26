# Plan: Replace bool flags with enums where they encode mutually-exclusive state

**Status:** Proposed (not started)
**Impact:** Removes typo-prone `String`/`bool` discriminators in reducers that
cross authorization or money boundaries; aligns `crm/leads`, `crm/inbox`, and
`hr/offboarding` with the existing `OpportunityState` / `ProposalStatus` /
`WorkflowVersionStatus` pattern already used in sibling modules.
**Scope:** Hand-written Rust in `spacetimedb/src` and (for the `elevated`
flag) `ai-gateway/src`. Generated bindings under
`api-server/src/stdb_sdk_bindings/` are out of scope ("DO NOT edit generated
bindings" — CLAUDE.md).

---

## Why

A scoping pass found ~1,046 `: bool` field occurrences in hand-written Rust.
Most are legitimate on/off toggles (`is_active`, `enabled`, day-of-week
flags). The genuine misuse is narrower: a handful of `bool`/`String` fields
that encode a **finite, mutually-exclusive domain**. These are the cases where
a wrong value is a silent bug (no exhaustiveness check, accepts typos) rather
than a compile error.

The codebase already proves the idiomatic fix is viable:
`spacetimedb/src/crm/opportunities.rs:187` defines a `SpacetimeType` enum
`OpportunityState { Open, Won, Lost }` *used directly as a table field*, with
`from_flags` (legacy read) / `from_flags_strict` (new write) helpers and a
`validate_transition` lifecycle guard. `proposals.rs:34 ProposalStatus`,
`workflow/definitions.rs:25 WorkflowVersionStatus`, and
`permissions.rs:88 PermissionEffect` follow the same pattern. So enum-in-table
is not a technical limitation here.

---

## Reference pattern

Adopt the `OpportunityState` shape for every conversion below:

```rust
#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum LeadState {
    New,
    Qualified,
    Converted,
    Lost,
}

impl LeadState {
    /// Accept the legacy string form on read; never panic.
    fn from_str_loose(s: &str) -> LeadState { ... }
    /// Strict parse of caller-supplied input; reject unknowns.
    fn from_str_strict(s: &str) -> Result<LeadState, String> { ... }
}
```

Rules (from repo `AGENTS.md` type-safety section):
- `#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]` for enums used
  as table fields / reducer params.
- Add a `from_*_strict` for caller input (rejects unknowns) and a loose
  reader for legacy rows.
- Keep `#[non_exhaustive]` off for now — these domains are stable and closed.

---

## Work items (ordered by risk → value)

### WP1 — `hr/offboarding.rs`: `item: String` → `OffboardingItem` enum

**Why first:** smallest, self-contained, and `item` is a *string*
discriminator over a 3-variant domain — the clearest bug surface.

- `spacetimedb/src/hr/offboarding.rs:42` — `CompleteOffboardingItemParams { pub item: String, .. }`
- `spacetimedb/src/hr/offboarding.rs:244-259` — `match params.item.trim()` over
  `"assets_returned"` / `"access_revoked"` / `"docs_collected"`.
- Table fields `assets_returned` / `access_revoked` / `docs_collected` (bool,
  lines 25-27) **stay bool** — they are independent completion flags, not the
  discriminator. Only the *param* `item` becomes an enum.

New enum:
```rust
#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum OffboardingItem {
    AssetsReturned,
    AccessRevoked,
    DocsCollected,
}
```
Change `CompleteOffboardingItemParams.item: String` → `OffboardingItem` and
replace the string `match` with an enum `match`.

**Touched:** 1 file + generated binding regeneration (`spacetime generate`).
**Risk:** low. No data migration (enum serializes over the wire).

### WP2 — `crm/leads.rs`: `state: String` → `LeadState` enum

**Why:** direct sibling of the already-migrated `crm/opportunities.rs`
(`OpportunityState`). Leaving `leads` as a string is an internal
inconsistency, not a design choice.

- `spacetimedb/src/crm/leads.rs:27, :214` — `pub state: String` with comment
  `// "new", "qualified", "converted", "lost"`.
- Callers comparing literals:
  - `:828` `if lead.state != "qualified"`
  - `:945` `state: "converted".to_string()`
  - `:508` `state: params.state` (write path)
- New `LeadState { New, Qualified, Converted, Lost }` with
  `from_str_strict`/`from_str_loose`.

**Touched:** `crm/leads.rs` + any route/reducer that constructs `Lead` rows.
Check `api-server/src/routes/*` and `ai-gateway` for lead-state construction.
**Risk:** medium — more callers; run the CRM E2E suite after.

### WP3 — `crm/inbox.rs`: `status: String` → enums (two domains)

Two distinct status fields with two distinct finite domains:
- `:40` `// open | snoozed | closed` → `InboxConversationStatus`
- `:65` `// draft | queued | sent | delivered | failed | received` → `InboxMessageStatus`
- `:133, :189` — two more `status: String` (confirm domain per table before
  converting; do not assume they share a domain).

**Touched:** `crm/inbox.rs` + callers.
**Risk:** medium. Same shape as WP2.

### WP4 — `ai/action_drafts.rs` + `ai-gateway`: `elevated: bool` → governance enum

**Why:** `elevated` crosses an **authorization boundary** (elevated drafts
require a different approver than the proposer, `action_drafts.rs:308-309`,
and require governance metadata, `:561-562`). A bool is a binary slice of a
risk axis the codebase already models as `RiskClass { Green, Amber, Red }`
(`ai-gateway/src/harness/manifest.rs:36`) and `DecisionOutcome { Allow,
DraftOnly, Deny }` (`harness/audit.rs:7`).

- `spacetimedb/src/ai/action_drafts.rs:62, :87` — `pub elevated: bool`
- `ai-gateway/src/routes/actions.rs:68, :81` — `elevated: bool`
- `ai-gateway/src/harness/audit.rs:104` — `elevated: bool` on
  `ActionDraftProposal`.

Decision needed before implementing: **reuse `RiskClass`** (unify the axis)
**or** introduce a focused `DraftGovernance { Standard, Elevated }`. Recommend
the focused enum unless `RiskClass` is already carried on these rows.

**Touched:** 3-4 files across two crates.
**Risk:** medium-high — crosses crates and a governance path. Pair with a test
that asserts elevated drafts are rejected when proposer == approver.

### WP5 — `sales/sales_core.rs`: line-nature cluster → `SaleLineType`

- `:316-326` — `is_downpayment` / `is_expense` / `is_service` are mutually
  exclusive line types → `enum SaleLineType { Product, Downpayment, Expense, Service }`.
- `is_delivered` (`:326`) **stays bool** — independent lifecycle flag.

**Touched:** `sales/sales_core.rs` + POS/sales reducers that construct lines.
**Risk:** medium-high — wide write surface. Do after WP1-3 land.

### WP6 — `sales/pos_transactions.rs`: line-kind cluster → `PosLineKind`

- `:63-64` `is_change` / `is_tip` (+ `is_reward_line` at `:48, :188`) →
  `enum PosLineKind { Sale, Change, Tip, Reward }`.

**Touched:** `pos_transactions.rs` + POS reducers.
**Risk:** medium. POS-specific; do after WP5.

---

## Explicitly out of scope (leave as `bool`)

- `is_active` / `active` / `enabled` on config & reference tables — genuine
  on/off, denormalized for fast filtering.
- `work_monday..work_sunday` in `projects/capacity.rs` — independent day
  flags (a `bitflags!` set is optional polish, not an enum).
- `mask_phone_fields` / `mask_payment_references` / `suppress_secrets`
  (`ai-gateway/harness/manifest.rs`) — independent privacy toggles.
- `cookie_secure`, `workflow_external_dispatch_enabled`
  (`api-server/src/config.rs`) — env-driven config toggles.
- `open_only`, `is_superuser` as *function parameters* in
  `api-server/workflow_reads.rs` — idiomatic query-shape flags.
- All `api-server/src/stdb_sdk_bindings/*` — generated.

---

## Verification per work item

1. `cargo check -p <crate>` for the touched crate.
2. `cargo clippy -p <crate> -- -D warnings` if the crate opts into it.
3. Regenerate client bindings if the changed type is a reducer param:
   `spacetime generate --lang rust --out-dir api-server/src/stdb_sdk_bindings ...`
   (do **not** hand-edit bindings).
4. Run the relevant E2E suite:
   - WP1: HR offboarding E2E.
   - WP2/WP3: CRM E2E (`scripts/` / `Makefile` targets).
   - WP4: AI action-drafts E2E.
   - WP5/WP6: Sales/POS E2E.
5. Grep the codebase for any remaining string-literal comparisons against the
   old domain to confirm no stragglers.

---

## Sequencing & delivery

Each WP is a **separate PR** stacked on the previous, so a regression in one
domain doesn't block the others. Suggested order: WP1 → WP2 → WP3 → WP4 →
WP5 → WP6. WP1-3 are low/medium risk and high clarity value; WP4-6 are
medium-high and can be deferred or done in parallel after WP3.

This PR (`vibe/bool-to-enum-plan-867b95`) is the **plan only** — no behavior
change. Implementation PRs follow.
