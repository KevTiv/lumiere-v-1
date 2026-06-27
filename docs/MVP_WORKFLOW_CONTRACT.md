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
| 3 | Create contact | `create_contact` | `/crm` → Contacts tab, `new-contact` | `manual` — covered in Phase 1 spec | Frontend |
| 4 | Create lead | `create_lead` | `/crm` → Leads, `new-lead` | `proven` — `module-smoke.spec.ts` | Workflow QA |
| 5 | Convert lead → customer/opportunity | `convert_lead_to_customer` | `/crm` → Leads, `convert-lead` action | `proven` — `mvp-lead-to-cash.spec.ts` | Workflow QA |
| 6 | Convert opportunity → sale order | `convert_opportunity_to_sale_order` | `/crm` → Opportunities, `convert-opp-order` | `proven` — `mvp-lead-to-cash.spec.ts` | Workflow QA |
| 7 | Add sale order line | `create_sale_order_line` | Sales order lines tab (CSV only; no create form) | `bff-assist` — `mvp-lead-to-cash.spec.ts` | Backend + QA |
| 8 | Confirm sale order | `confirm_sales_order` | `/sales` → Orders, `confirm-orders` | `proven` — `mvp-lead-to-cash.spec.ts` | Workflow QA |
| 9 | Assign/validate delivery | `assign_stock_picking`, `validate_stock_picking` | `/sales` → Deliveries or `/inventory` pickings | `manual` — partial actions in sales-client | Workflow QA |
| 10 | Create invoice from SO | `create_invoice_from_sale_order` | `/sales` → `create-invoice` action + modal | `proven` — `mvp-lead-to-cash.spec.ts` | Workflow QA |
| 11 | Post account move | `post_account_move` / `post_invoice` | `/accounting` → Invoices / move detail | `bff-assist` — `mvp-lead-to-cash.spec.ts` | Accounting |
| 12 | Register payment | `register_payment_on_invoice` | `/accounting` → Payments | `bff-assist` — `mvp-lead-to-cash.spec.ts` | Accounting |
| 13 | Dashboard / report updates | query resources | `/overview`, module dashboards | `manual` — seeded cards in module specs | Frontend |
| 14 | AI business insight | ai-gateway RAG | modules-shell chat, `/api/ai/rag` | `manual` | AI Harness |
| 15 | AI action draft | `create_ai_action_draft` | `/api/ai/actions/draft`, ai-action-drafts module | `manual` — planned `mvp-ai-action-draft.spec.ts` | AI Harness |
| 16 | Approve/reject draft | `approve_ai_action_draft`, `reject_ai_action_draft` | `/ai-action-drafts` | `manual` | AI Harness |
| 17 | Audit trail | `audit_log` table (via `write_audit_log_v2`) | Settings / audit views | `manual` | Security |

## Known gaps (explicit)

1. **Sale order line UI** — reducer wired; no create form on order-lines tab (CSV import only). Golden-path E2E uses BFF `create_sale_order_line` until a form exists.
2. **Opportunity lines UI** — convert SO pulls lines from `opportunity_line`; no UI to add lines pre-convert.
3. **Full delivery E2E** — pickings lifecycle actions exist but no single spec validates assign → validate after UI-created SO.
4. **Post/payment UI** — posting uses move detail / invoice modals; golden-path uses BFF for deterministic CI.
5. **Tier-2 procure-to-pay** — optional `mvp-procure-to-pay.spec.ts` (not MVP gate).

## Secondary path: procure-to-pay

| Step | Reducer(s) | Frontend | E2E |
|------|------------|----------|-----|
| Create PO | `create_purchase_order` | `/purchasing` | `manual` |
| Confirm PO | `confirm_purchase_order` | `/purchasing` | `seed-only` — `PO/2024/0001` |
| Vendor bill | `create_bill_from_purchase_order` | `/accounting` | `manual` |
| Post bill | `post_account_move` | `/accounting` | `manual` |

## Exit criteria (MVP)

- [ ] `mvp-lead-to-cash.spec.ts` passes on `E2E_CLEAR_DB=1 make e2e-smoke`
- [ ] `run_all_domain_tests` passes in e2e-smoke setup
- [ ] Reducer allowlist `strict` in production
- [ ] Cross-org query/call rejected at api-server
- [ ] All rows above have owner; no `missing` wiring for steps 1–12

## Related

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [erp-mvp-coordinator-mission.md](../.cursor/plans/erp-mvp-coordinator-mission.md)
