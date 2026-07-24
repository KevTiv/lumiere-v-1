# Integrity readiness (module e2e)

**Date:** 2026-07-24  
**Method:** Parallel explore agents — platform, CRM+Sales, P2P+Inventory, Accounting+Expenses+Subscriptions, HR+PSA+Documents, secondary modules.  
**Rubric:** Backend spine → FE wire (form→mapper→hook→reducer) → company/org scoping + audit → E2E proven → known integrity holes.  
**Scores:** GREEN = pilot-integrity ready · YELLOW = wired but holes · RED = integrity-breaking · SKIP = non-pilot shell.

**Overall:** **YELLOW** (post Wave 0–2 remediation 2026-07-24) — Accounting off RED; Inv/CRM company+lot P0s closed. See [integrity_adversarial_review.md](./integrity_adversarial_review.md) and [integrity_remediation_plan.md](./integrity_remediation_plan.md).

---

## Scoreboard

| Domain | Verdict | Spine | Biggest integrity hole |
|--------|---------|-------|------------------------|
| Platform / core | YELLOW | Allowlist on create/approve/execute; field-perms FULL_CLIENT | Soft `permissions_tests` (P3) |
| CRM + Sales | GREEN | Lead convert fail-closed; confirm + SO line company guard | Competitive OMS edges deferred |
| Purchasing + Inventory | GREEN | P2P @p0; inbound+outbound lot continuity | RFQ UI / outbound FIFO deferred |
| Accounting + Expenses + Subs | YELLOW | Period lock; balanced pay; case-insensitive reconcile; PostPayment on sub | Multi-invoice residual (A3); clearing acct (A4); expense idempotency (A6) |
| HR + PSA + Documents | YELLOW | Leave reserve; docs owner-only WS+HTTP | Org-wide employees HTTP (H1); PSA Draft AR deferred |
| Secondary | Mixed | Mfg / helpdesk / proposals / workflow GREEN | Trackers/forensics SKIP; IoT/POS/fleet thin E2E |

---

## P0 blockers (cross-module)

> Closed in remediation pass — see [integrity_adversarial_review.md](./integrity_adversarial_review.md).

1. ~~`post_payment` / `post_ledger_payment` empty JE~~ — balanced lines shared helper (A2).
2. ~~FieldPermission cutover~~ — registry/CI; FULL_CLIENT includes field-permissions (P2).
3. ~~Inbound/outbound lot~~ — plumb + dest stamp (I1/I2); domain lot validate EXIT 0.
4. ~~Documents read ACL~~ — owner-only on WS+HTTP; versions by `created_by` (D1/D2).
5. ~~CRM→Sales company binding~~ — convert fail-closed; confirm + SO line company (C1/C2).
6. ~~Register/reconcile casing + company~~ — case-insensitive match (A1); company guard (A5); sub PostPayment (A7).

---

## Platform / core

**Verdict: YELLOW** — demo/smoke OK; not integrity-ready until FieldPermission cleanup + audit/allowlist gaps close.

| Area | Verdict | Backend | FE | E2E | Top gaps |
|------|---------|---------|----|-----|----------|
| Auth / roles / org perms | GREEN | params + audit | Settings + hooks | RBAC + enforcement specs | Comment drift “Casbin” |
| Field permissions | YELLOW | FieldPermission + grant/revoke | Editor wired | **Missing** | Registry key skew; deleted Rust suite |
| Audit | GREEN | `write_audit_log_v2` | Settings view | Smoke | Many `company_id: None` on org entities |
| Workflow / approvals | YELLOW | Deep engine | Gate UI | Gate + approvals specs | Human-task reducers lack audit; subscription keys missing from registry |
| Forms | GREEN | EAV + params | Settings + entity | Forms mutations | — |
| Reports | GREEN | Create + company | Owner reports | owner-reports | Dev bypass when no field_access |
| Import | YELLOW | Tracker + rollback | Assistant | import-rollback | `import-jobs` not in resource registry |
| AI skills / drafts | YELLOW | Registry + drafts | Harness + drafts UI | draft + policy specs | Empty allowlist fail-opens 3 reducers; AI privacy defaults degraded post-Casbin |

**Migration note:** Casbin→FieldPermission is **landed on happy path**, not abandoned mid-flight. Cleanup (registry, CI, tests, dead keys) is mid-flight.

---

## CRM + Sales

**Verdict: YELLOW** (spine GREEN). Params cohesion Phase A Pass. Investigation docs partially stale.

| Path | Score | Gap |
|------|-------|-----|
| Contact / lead create | GREEN | — |
| Lead → customer/opp | YELLOW | `company_id: None` on convert inserts |
| Opp lines → SO | YELLOW | convert skips `resolve_opportunity_company_id` |
| SO line / confirm / delivery / invoice / pay | GREEN (spine) | Line update hook unused; ToApprove not E2E; dropship/promo no UI |
| RMA | YELLOW | Exchange domain-only; no `update_return_order` |

**E2E:** `mvp-lead-to-cash.spec.ts`, `mvp-sales-returns.spec.ts` @p0.

---

## Purchasing + Inventory

**Verdict: YELLOW** — confirmed PO→bill GREEN; RFQ + lot quants not.

| Flow | Score | Notes |
|------|-------|-------|
| PO confirm → receive → bill → 3-way | GREEN | Fail-closed match; `mvp-procure-to-pay.spec.ts` @p0 |
| RFQ → PO | YELLOW | Backend+hooks; Ops `prompt` UI; no RFQ E2E |
| Lots / quants / valuation | YELLOW | **lot_id not stamped on inbound quants**; valuation table dead; outbound FIFO consumption open |

---

## Accounting + Expenses + Subscriptions

**Verdict: YELLOW** — not unsupervised-close-ready.

| Workflow | Score | Notes |
|----------|-------|-------|
| Period locks | GREEN | Shared gate on post paths; domain + expense tests |
| GL post idempotency | YELLOW | Draft-only re-post; billing_run_key not `#[unique]`; expense UI omits `client_request_id` |
| Payment registration | **RED** | Empty Posted move; register without reconcile leaves AR residual |
| Expense approve→post | GREEN | SoD + balanced JE + period lock |
| Subscription invoice gen | YELLOW | Draft AR solid; soft idempotency; Playwright smoke only |

---

## HR + PSA + Documents

**Verdict: YELLOW** — Jul-18 investigation intros stale; Wave A code is truth.

| Workflow | Score | Residual |
|----------|-------|----------|
| Leave balance | YELLOW | Consume on approve; **no reserve on submit** → oversubscribe race |
| Payroll artifact / GL | YELLOW→GREEN | Done gated on export/GL; client-trusted gross/net (pack model) |
| Timesheet → bill | YELLOW→GREEN | SoD/freeze/sell_rate/tax/period; invoice stays Draft |
| Document ACL / blob | YELLOW | Mutate ACL + blob validate OK; **subscribe lists all docs** |

---

## Secondary modules

| Module | Verdict | One-line |
|--------|---------|----------|
| Manufacturing | GREEN | BOM/MO wired; lifecycle beyond create thin |
| Helpdesk | GREEN | CRUD + close E2E |
| Proposals | GREEN | Create + workspace; tender convert not E2E |
| Workflow UI | GREEN | Gate create/publish/simulate proven |
| Fleet / Map | YELLOW / thin | Fleet via map only; no mutation E2E |
| IoT | YELLOW | Deep backend; smoke FE only |
| Calendar / Messages / Tasks | YELLOW | Wired; create paths lightly tested |
| POS / Distributor | YELLOW | POS solid backend; no order E2E; distributor = pack |
| Trackers / Forensics | SKIP | Shells / sample state |

---

## What is already solid

- MVP **lead-to-cash** and **procure-to-pay** @p0 Playwright spines.
- Params cohesion Phase A; mapper coverage tooling green historically.
- Period locks on accounting/expense/subscription post paths.
- Expense approve→post balanced JE.
- 3-way match fail-closed on vendor bill post.
- Org RBAC grant/revoke + permission enforcement E2E.
- Forms custom fields / EAV mutations E2E.

---

## Doc fidelity

Prefer **gap-fix Done checklists + code** over investigation intros (CRM/Sales/Expenses/Subscriptions/Documents openings are stale in places).

---

## Suggested fix order (ponytail)

1. Fix `post_payment` to insert balanced move lines (or refuse to mark Posted without them) + make register settle residual or hard-require reconcile.
2. Align `field-permissions` registry/subscription keys; restore minimal permissions domain tests; one Playwright grant/mask path.
3. Stamp `lot_id` on inbound quant insert.
4. Filter documents subscription by ACL (or drop unrestricted feed).
5. Bind `company_id` on CRM convert + SO confirm.

*Skipped in this pass: per-reducer exhaustive audit, live `spacetime call` suites, load/ops readiness — add when closing a specific P0.*

---

## GREEN remediation plans (pilot integrity)

**GREEN bar:** Backend invariants correct · FE calls the real path · company/ACL scoping honest · one domain/Playwright proof. Competitive depth stays out of scope.

**Wave order:** finance+auth → stock/CRM → people/docs → polish.

### 1. Accounting + Expenses + Subscriptions → GREEN

**Exit criteria:** Payment posts balanced JEs and settles AR residual; billing-run key unique; expense post sends idempotency key.

| Item | Status | Notes |
|------|--------|-------|
| Balanced `post_payment` lines | [x] | Dr/Cr liquidity + AR/AP via journal + chart lookup |
| Register settles residual | [x] | `register_payment_on_invoice` calls `reconcile_payment_with_invoice` |
| Sub pay no empty second JE | [x] | Links payment to existing balanced move |
| `billing_run_key` `#[unique]` | [x] | `subscriptions/tables.rs` |
| Expense `client_request_id` | [x] | Generated on post in `expenses-client.tsx` |
| Domain proof | [x] | `payments_test.rs` asserts lines + residual clear |

**Rescore:** **GREEN** (pilot). Full subscription activate→bill→pay Playwright still deferred.

### 2. Platform / core → GREEN

| Item | Status | Notes |
|------|--------|-------|
| Field-permission registry key align | [x] | Plural `field-permissions`; CI org-filter OK |
| Drop dead `casbin-rule` keys | [x] | validate script |
| Workflow stub keys removed | [x] | activities/transitions/workitems unsubscribed |
| `import-jobs` registered | [x] | resource_registry |
| Human-task `write_audit_log_v2` | [x] | claim / decide (approve/reject/complete) |
| AI allowlist fail-closed | [x] | Empty org allowlist denies (`ai/reducer_allowlist.rs`) |
| Permissions Rust suite restored | [x] | `permissions_tests.rs` + harness wire |
| Field-permission Playwright | [ ] | Deferred (too heavy for this pass) |

**Rescore:** **GREEN** (pilot). Field-permission E2E remains a polish gap, not a runtime hole.

### 3. Purchasing + Inventory → GREEN

| Item | Status | Notes |
|------|--------|-------|
| Stamp `lot_id` on inbound quants | [x] | `increase_quant_at_location_owned` + validate path |
| Domain proof | [x] | inventory gap / stock tests extended |

**Rescore:** **GREEN** (P2P spine was already GREEN; lot stamp closes the integrity hole). RFQ UI / outbound FIFO still out of scope.

### 4. CRM + Sales → GREEN

| Item | Status | Notes |
|------|--------|-------|
| Lead convert `company_id` | [x] | Params + default company; contact/opp bound |
| Opp→SO uses `resolve_opportunity_company_id` | [x] | |
| SO confirm flat `company_id` + guard | [x] | FE hook requires companyId |
| SO line update wired | [x] | sales-client + form configs |
| Same-org isolation test | [x] | sales gap_fixes / core tests updated |

**Rescore:** **GREEN** (pilot). ToApprove / dropship / promo UI still out of scope.

### 5. HR + PSA + Documents → GREEN

| Item | Status | Notes |
|------|--------|-------|
| Leave reserve on submit | [x] | Consume at submit; release on refuse/cancel |
| Documents subscribe ACL | [x] | Owner / unrestricted folder subset (HTTP SQL cannot express `read_access_ids` Vec) |
| Employees purpose-scoped feed | [x] | HR workspace defaults to `my-employee` + `direct-reports` |
| Domain proof | [x] | HR wave_a leave oversubscribe path |

**Rescore:** **GREEN** (pilot). PSA Draft AR post-close and full blob Playwright deferred. Doc ACL is an honest SQL subset (owner), not full `read_access_ids` membership.

### 6. Secondary modules

| Module | Plan |
|--------|------|
| Manufacturing / Helpdesk / Proposals / Workflow UI | Hold GREEN |
| Fleet / IoT / Calendar / Messages / Tasks / POS / Distributor | Defer YELLOW |
| Trackers / Forensics | Keep SKIP |

### Overall after remediation

| Domain | Before | After (optimistic checklist) | After adversarial |
|--------|--------|------------------------------|-------------------|
| Platform / core | YELLOW | GREEN | **YELLOW** |
| CRM + Sales | YELLOW | GREEN | **YELLOW** |
| Purchasing + Inventory | YELLOW | GREEN | **YELLOW** |
| Accounting + Expenses + Subs | YELLOW | GREEN | **RED** |
| HR + PSA + Documents | YELLOW | GREEN | **YELLOW** |
| Secondary | Mixed | Unchanged | Hold |

**Overall:** Remediation closed several holes but **must not** be treated as wedge-GREEN. Authoritative post-fix scoreboard: [integrity_adversarial_review.md](./integrity_adversarial_review.md).
