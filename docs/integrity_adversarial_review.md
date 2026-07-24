# Integrity adversarial re-inspection

**Date:** 2026-07-24 (post `b67840a93`)  
**Remediation pass:** same day — see [integrity_remediation_plan.md](./integrity_remediation_plan.md)  
**Method:** Bugbot + parallel adversarial explore agents, then Wave 0–2 fix agents.  
**Prior optimistic report:** [integrity_readiness.md](./integrity_readiness.md)

**Overall (post-remediation):** **YELLOW** — Accounting off **RED**; P0 A1/A2/D1/D2/I1/I2/C1/C2/P1/P2/A5/A7 closed. Residual: A3/A4/A6, H1 employees HTTP, P3 test honesty, PSA Draft AR deferred.

---

## Scoreboard

| Domain | Adversarial | Post-remediation | Why |
|--------|-------------|------------------|-----|
| Accounting + Expenses + Subs | **RED** | **YELLOW** | Case-insensitive reconcile; balanced `post_ledger_payment`; company guard; sub pay PostPayment. Still: multi-invoice residual (A3), clearing-account pick (A4), expense idempotency (A6) |
| HR + PSA + Documents | YELLOW | **YELLOW** | Docs/folders/versions owner-only on WS+HTTP. Still: org-wide employees via SSR/query (H1); PSA Draft AR deferred (do not score GREEN) |
| Purchasing + Inventory | YELLOW | **GREEN** | Inbound lot plumb + outbound dest keeps lot; domain lot validate passed |
| CRM + Sales | YELLOW | **GREEN** | Lead convert fail-closed; SO line `company_id` guard; confirm already held |
| Platform / core | YELLOW | **YELLOW** | Allowlist on approve/execute; field-permissions on FULL_CLIENT. Still: P3 soft permissions_tests |
| Secondary | Hold | Hold | Unchanged |

---

## P0 status (closed this pass)

| ID | Status | Fix |
|----|--------|-----|
| A1 | Closed | Case-insensitive reconcile (`eq_ignore_ascii_case`) |
| A1t | Closed | Payment tests no longer patch casing |
| A2 | Closed | Shared `insert_balanced_payment_lines_and_post` in `post_ledger_payment` |
| A5 | Closed | Register/reconcile company+org guard |
| A7 | Closed | Sub pay → `post_payment_impl` (PostPayment gate) |
| D1 | Closed | HTTP `query_exec` owner-only for documents/folders |
| D2 | Closed | `document-versions` filtered by `created_by` (WS+HTTP+FE) |
| I1 | Closed | PO/return/consignment/MO plumb optional `lot_id` |
| I2 | Closed | Outbound dest uses owned helper with move `lot_id` |
| C1 | Closed | Convert uses `?` on default company (no `.ok()` swallow) |
| C2 | Closed | `update_sale_order_line(org, company_id, line_id, params)` |
| P1 | Closed | Allowlist re-check on approve + execute |
| P2 | Closed | `field-permissions` on FULL_CLIENT lists |

---

## Still open (P1+)

| ID | Area | Finding |
|----|------|---------|
| A3 | Payments | Multi-invoice register zeros full payment residual on first reconcile |
| A4 | Payments | Clearing account = first AR/AP for company, not invoice’s account |
| A6 | Expenses | `clientRequestId` regenerated per click |
| H1 | HR | Org-wide `employees` via SSR / `/api/query/employees` / expenses |
| P3 | Platform | `permissions_tests` soft/wrong on snapshot assertions |
| — | PSA | Draft AR post-close deferred — do not mark GREEN |

---

## Remediation agents

| Agent | Scope | Result |
|-------|-------|--------|
| [Finance](57498760-0319-4cc7-bada-e7d32d0ae93e) | A1, A1t, A2, A5, A7 | Done — wasm check OK |
| [Docs ACL](edb054ba-af30-4c00-a0af-7fa49ae361e0) | D1, D2, D1b | Done — owner-only |
| [Inventory lots](bf22c639-5811-4ed7-ab68-191aad3063ee) | I1, I2 | Done — lot validate EXIT 0 |
| [CRM/Platform](65df74fe-e0a4-4686-a708-f385a8d77011) | C1, C2, P1, P2 | Done — regenerate bindings before publish |

## Prior adversarial agents

| Agent | Focus | Verdict then |
|-------|-------|--------------|
| [Bugbot](d379677d-f221-4f8b-997c-ade4c8c7fa2e) | Diff review | High: doc-versions; register company; outbound lot |
| [Finance adv](c6b0ec95-28d8-435c-8535-71dfef86595c) | Acct/Exp/Subs | **RED** |
| [Platform adv](d9a2472e-358d-4592-a25f-d68ce4c21159) | Core | **YELLOW** |
| [Stock/CRM adv](e0fad9bd-b545-4225-ac1c-545eba54a8de) | Inv + Sales | **YELLOW** |
| [HR/Docs adv](201cbf4f-14c1-4539-a38c-b050dd71319a) | HR/PSA/Docs | **YELLOW** |
| [Secondary](58366711-142c-4c0a-87d3-677db60ed7ed) | Secondary | Hold |

---

## Before publish

```bash
make generate-stdb-ts-sdk
make generate-stdb-rust-sdk
```

Hand-patched bindings for SO line signature / lot params — regenerate to clear drift.

*Do not claim overall GREEN while A3/A4/H1/PSA remain open.*
