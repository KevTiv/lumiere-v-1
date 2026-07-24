# Integrity remediation plan (post-adversarial)

**Source:** [integrity_adversarial_review.md](./integrity_adversarial_review.md)  
**Goal:** Close P0s that keep Accounting **RED** and Docs/Inv/CRM/Platform **YELLOW**, with production-faithful proofs.  
**Non-goal:** Competitive OMS depth, full sub activate→pay Playwright, PSA Draft AR close (keep deferred, do not score GREEN).

---

## Wave 0 — Accounting RED → YELLOW/GREEN bar

| ID | Work | Files (primary) | Acceptance |
|----|------|-----------------|------------|
| **A1** | Make reconcile match `account_internal_type` **case-insensitively** (`receivable`/`Receivable`, `payable`/`Payable`). Do **not** rewrite insert `format!("{:?}", t)`. | `journal_entries.rs` reconcile filters (~2655+) | SO invoice → pay → register clears residual **without** `patch_receivable_line_type` |
| **A1t** | Stop using `patch_receivable_line_type` in payment residual proofs once A1 lands | `tests/accounting/helpers.rs`, `payments_test.rs` | Test fails if case-insensitive match regresses |
| **A2** | Reuse `post_payment` line builder (liquidity + AR/AP) inside `post_ledger_payment`; never flip Posted with zero lines | `payment_management.rs` (~338+); share helper with `payments.rs` | Domain/smoke: ledger payment move has ≥2 lines, debit≈credit |
| **A5** | Guard register/reconcile: payment `company_id` == invoice move `company_id` (and org) | `payments.rs` register loop; `reconcile_payment_with_invoice` | Wrong-company invoice_id → Err; no residual mutate |
| **A7** | Enforce same `PostPayment` / approval gate on subscription pay before marking Paid / linking move | `billing_helpers.rs` sub pay; align with `payments.rs` guard | Sub pay without approval → Err |

**Exit:** Accounting scoreboard can leave **RED** once A1+A1t+A2+A5+A7 pass. A3/A4/A6 stay Wave 2.

---

## Wave 1 — Documents ACL (D1/D2) + inventory lots (I1/I2)

### Documents

| ID | Work | Acceptance |
|----|------|------------|
| **D1** | Mirror WS owner/folder rules on HTTP `query_exec` for `documents`, `documents-deleted`, `document-folders` (identity-aware `extra_where`, not org-only) | `/api/query/documents` returns only owner (or agreed ACL subset); SSR/UI cannot list peers’ docs |
| **D2** | Filter `document-versions` on WS **and** HTTP to versions whose parent document is visible to caller | Peer version `url` / checksum not in feed |
| **D1b** | Align FE special-case SQL with Rust (`erp-subscriptions.ts` ↔ `erp_subscriptions.rs`) | Twin parity check / comment honesty in `query_exec` |

**Honest subset note:** Current WS is owner-only (not full `read_access_ids`). Either document that as the pilot ACL, or extend both WS+HTTP to unrestricted-folder + ACL — pick one and apply everywhere.

### Inventory

| ID | Work | Acceptance |
|----|------|------------|
| **I1** | Pass move `lot_id` (or lot from PO line/product) when creating inbound moves: PO receive, returns, consignment | Validate stamps quant with that lot; domain test without hand-built lot-only move |
| **I2** | Outbound dest branch: `increase_quant_at_location_owned(..., lot_id)` not bare helper; source consume prefer lot-matched quant when move has lot | Internal transfer keeps lot on dest quant |

**Exit:** Docs no longer P0; Inv lot continuity holds for inbound+outbound validate path.

---

## Wave 2 — CRM/Sales + Platform P1 + payment residuals

| ID | Work | Acceptance |
|----|------|------------|
| **C1** | Lead convert: if no `company_id` and no default company → **Err** (remove `.ok()` swallow) | No contact/opp with `company_id: None` |
| **C2** | `update_sale_order_line`: flat `company_id` + ownership guard like `update_sale_order` | Cross-company line edit Err |
| **P1** | Re-check `is_allowed_ai_reducer` on approve **and** execute | Empty/disabled allowlist blocks pending drafts |
| **P2** | Add `field-permissions` to FULL_CLIENT live subscribe list (auth asset + FE) | Providers get live field-perm rows |
| **P3** | Harden `permissions_tests` (assignees + hard snapshot assert, or fix docstring) | Test matches claimed behavior |
| **A3** | Multi-invoice reconcile: allocate payment residual per invoice, don’t zero full residual on first | Two invoices partial settle correctly |
| **A4** | Prefer invoice line’s AR/AP `account_id` for clearing (fallback first-of-type) | Same GL account on clear |
| **A6** | Stable expense `clientRequestId` (form/session scoped, not per-click UUID) | Retry same key → silent Ok |

**Defer (do not score GREEN):** PSA Draft AR post-close; full employees row ACL beyond purpose feeds; outbound FIFO depth; field-permission Playwright; helpdesk `company_id: None` audits.

---

## Wave 3 — Docs / scoreboard honesty

1. Update [integrity_adversarial_review.md](./integrity_adversarial_review.md) checkboxes as waves close.
2. Re-score [integrity_readiness.md](./integrity_readiness.md) only when acceptance tests pass.
3. PSA / competitive OMS remain deferred in scoreboard text — never mark GREEN while deferred.

---

## Suggested implementation order (shortest path off RED)

```
A1 (case-insensitive reconcile) → A1t → A5 → A2 → A7 (PostPayment on sub pay)
D1 → D2 → D1b          # Docs P0 (owner-only)
I2 → I1                # Lot continuity
C1 → C2 → P1 → P2      # Fail-closed company + allowlist
A3 / A4 / A6 / P3      # Residual integrity
```

---

## Proof requirements (no fake GREEN)

| Area | Required proof |
|------|----------------|
| Payments | Domain test: create SO invoice **without** casing patch → register → residual 0 |
| Ledger pay | Assert line count ≥ 2 + balanced |
| Docs | HTTP query as user B cannot see user A’s doc/version URL |
| Lots | Inbound PO receive with lot + outbound transfer keeps lot on dest |
| CRM | Convert without company/default → Err |
| AI | Create draft, empty allowlist, approve/execute → Err |

---

## Locked decisions (2026-07-24)

1. **Docs ACL:** owner-only on WS **and** HTTP (match current WS; no `read_access_ids` expansion this pass).
2. **A1:** **case-insensitive reconcile only** — do not rewrite insert vocabulary; matcher accepts `receivable`/`Receivable` (and payable variants). Keep A1t: payment tests must not rely on `patch_receivable_line_type` if reconcile is case-insensitive (or assert both casings).
3. **A7:** **enforce PostPayment gate** on subscription pay path (no silent approval bypass).

## Agents

| Wave | Agent | Scope | Status |
|------|-------|-------|--------|
| 0 | [Finance](57498760-0319-4cc7-bada-e7d32d0ae93e) | A1, A1t, A2, A5, A7 | **Done** |
| 1 | [Docs ACL](edb054ba-af30-4c00-a0af-7fa49ae361e0) | D1, D2, D1b | **Done** |
| 1 | [Inventory lots](bf22c639-5811-4ed7-ab68-191aad3063ee) | I1, I2 | **Done** — lot validate EXIT 0 |
| 2 | [CRM/Platform](65df74fe-e0a4-4686-a708-f385a8d77011) | C1, C2, P1, P2 | **Done** |

**Post-pass scoreboard:** [integrity_adversarial_review.md](./integrity_adversarial_review.md) (Accounting RED→YELLOW; Inv/CRM → GREEN).
