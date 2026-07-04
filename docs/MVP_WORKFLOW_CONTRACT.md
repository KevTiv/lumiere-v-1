# MVP workflow contract

Maps the [17-step acceptance script](#acceptance-script) to backend reducers, frontend routes, E2E status, and owners.

**E2E status legend**

| Status | Meaning |
|--------|---------|
| `proven` | Automated E2E creates data and asserts outcome |
| `seed-only` | E2E reads seeded fixture only |
| `manual` | Wired in UI; no automated workflow test yet |
| `bff-assist` | UI path plus authenticated BFF `/api/call` for a known UI gap |

Generated from [reducer-coverage-matrix.md](./reducer-coverage-matrix.md) and [frontend/web/tests/e2e/](../frontend/web/tests/e2e/).

## Acceptance script

| Step | Workflow | Backend | Frontend | E2E | Owner |
|------|----------|---------|----------|-----|-------|
| 1 | Sign in | `sign_in_with_password` (api-server auth) | `/sign-in` | `proven` — `auth-shell.spec.ts` | Workflow QA |
| 2 | Bootstrap org / tenant | `bootstrap_new_tenant` (blocked on public `/call` in prod) | `/sign-up`, `/api/bootstrap/tenant` | `seed-only` — e2e uses `seed_dev_data` + `seed-test-user` | DevOps |
| 3 | Create contact | `create_contact` | `/crm` → Contacts tab, `new-contact` | `proven` — `mvp-lead-to-cash.spec.ts` | Frontend |
| 4 | Create lead | `create_lead` | `/crm` → Leads, `new-lead` (state = Qualified) | `proven` — `mvp-lead-to-cash.spec.ts` | Workflow QA |
| 5 | Convert lead → customer/opportunity | `convert_lead_to_customer` | `/crm` → Leads, `convert-lead` action | `proven` — `mvp-lead-to-cash.spec.ts` (UI) | Workflow QA |
| 6 | Convert opportunity → sale order | `convert_opportunity_to_sale_order` | `/crm` → Opportunities, `convert-opp-order` | `proven` — `mvp-lead-to-cash.spec.ts` (UI) | Workflow QA |
| 7 | Add sale order line | `create_sale_order_line` | `/sales` → Order lines tab, `add-sale-order-line` | `proven` — `mvp-lead-to-cash.spec.ts` | Workflow QA |
| 8 | Confirm sale order | `confirm_sales_order` | `/sales` → Orders, `confirm-orders` | `proven` — `mvp-lead-to-cash.spec.ts` | Workflow QA |
| 9 | Assign/validate delivery | `confirm_stock_picking`, `assign_stock_picking`, `validate_stock_picking` | `/sales` → Fulfillment tab | `proven` — `mvp-lead-to-cash.spec.ts` (confirm → assign → validate) | Workflow QA |
| 10 | Create invoice from SO | `create_invoice_from_sale_order` | `/sales` → `create-invoice` action + modal | `proven` — `mvp-lead-to-cash.spec.ts` | Workflow QA |
| 11 | Post account move | `post_account_move` / `post_invoice` | `/accounting` → Invoices → detail modal → Post | `proven` — `mvp-lead-to-cash.spec.ts` | Accounting |
| 12 | Register payment | `create_payment` → `post_payment` → `register_payment_on_invoice` | `/accounting` → Payments | `proven` — `mvp-lead-to-cash.spec.ts` (UI create → post → register) | Accounting |
| 13 | Dashboard / report updates | query resources | `/overview`, module dashboards | `manual` — seeded cards in module specs | Frontend |
| 14 | AI business insight | ai-gateway RAG | modules-shell chat, `/api/ai/rag` | `manual` | AI Harness |
| 15 | AI action draft | `create_ai_action_draft` | `/api/ai/actions/draft`, ai-action-drafts module | `manual` — planned `mvp-ai-action-draft.spec.ts` | AI Harness |
| 16 | Approve/reject draft | `approve_ai_action_draft`, `reject_ai_action_draft` | `/ai-action-drafts` | `manual` | AI Harness |
| 17 | Audit trail | `audit_log` table (via `write_audit_log_v2`) | Settings / audit views | `manual` | Security |

## Known gaps (explicit)

1. **Opportunity lines UI** — convert SO pulls lines from `opportunity_line`; no UI to add lines pre-convert.
2. **Procure-to-pay** — complete: `mvp-procure-to-pay.spec.ts` (full UI path including receive and post bill).

## Secondary path: procure-to-pay

| Step | Reducer(s) | Frontend | E2E |
|------|------------|----------|-----|
| Create PO | `create_purchase_order` | `/purchasing` | `proven` — `mvp-procure-to-pay.spec.ts` |
| Confirm PO | `confirm_purchase_order` | `/purchasing` | `proven` — `mvp-procure-to-pay.spec.ts` |
| Receive goods | `receive_po_line` | `/purchasing` → Lines, receive form | `proven` — `mvp-procure-to-pay.spec.ts` |
| Vendor bill | `create_bill_from_purchase_order` | `/purchasing` → PO `create-bill` modal | `proven` — `mvp-procure-to-pay.spec.ts` |
| Post bill | `post_invoice` | `/accounting` → Bills → detail modal → Post | `proven` — `mvp-procure-to-pay.spec.ts` |

## Exit criteria (MVP)

- [ ] `mvp-lead-to-cash.spec.ts` passes on `E2E_CLEAR_DB=1 make e2e-smoke`
- [ ] `run_all_domain_tests` passes in e2e-smoke setup
- [ ] Reducer allowlist `strict` in production
- [ ] Cross-org query/call rejected at api-server
- [ ] All rows above have owner; no `missing` wiring for steps 1–12

## Related

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [MVP_PARAMS_COHESION_AUDIT.md](./MVP_PARAMS_COHESION_AUDIT.md) — form ↔ params struct audit ledger (MVP gate)
- [erp-mvp-coordinator-mission.md](../.cursor/plans/erp-mvp-coordinator-mission.md)
