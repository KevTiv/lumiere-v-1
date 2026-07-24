# ERP Relational Integrity & Mutation Provenance Audit

**Date:** 2026-07-24  
**Method:** Parallel explore sub-agents across all implemented module domains (CRM+Sales, P2P+Inventory, Accounting+Expenses+Subscriptions, HR+PSA+Documents, Platform/core, Secondary). Adversarial posture — break claimed relational completeness, not confirm mapper coverage.  
**Prior reports:** [integrity_readiness.md](./integrity_readiness.md) · [integrity_adversarial_review.md](./integrity_adversarial_review.md) (payment/ACL wedge). This run is a **different bar**: foreign-key provenance, compiler-only fields, and end-to-end relation wiring.

**Overall:** **Unsafe for real ERP data** (cohort). Several spines are pilotable under hard restrictions. No domain is production-ready on this rubric.

```text
Unsafe for real ERP data
```

---

## Scoreboard (relational provenance)

| Domain | Agent | Verdict | Biggest relational hole |
|--------|-------|---------|-------------------------|
| Accounting + Expenses + Subs | [Finance](d1b0984c-3456-4a03-a4b4-cff696ce7a8d) | **Unsafe** | Empty `post_ledger_payment` JE; `"Receivable"` vs `"receivable"`; no register company guard |
| CRM + Sales | [CRM/Sales](ba3d9ffe-912c-4dd5-a18d-f2b551fd25e7) | Compiler-complete / semantically incomplete | Ghost products; magic currency/UoM `1`; partner/stage/tag without org scope |
| Purchasing + Inventory | [P2P/Inv](42044701-f34a-4fa9-8d6f-61d531733e5e) | Partially relational | Inbound `lot_id: None`; outbound dest drops lot; assign never reserves; `0n` coverage FKs |
| HR + PSA + Documents | [HR/Docs](9650c1b4-5d29-40e9-ba0a-7665bec23913) | Partially relational | Soft employee/leave FKs; FE `0n` accounts; versions ACL = `created_by` not doc owner; shares unused in SQL |
| Platform / core | [Platform](45d22741-069a-4039-b4b7-382a30920632) | Pilot with restrictions (YELLOW) | Allowlist not re-checked on approve/execute; AI company stamp without company∈org; soft FieldPermission resources |
| Secondary | [Secondary](bcd3f1c6-b9fb-4f8c-96ce-c56e580e6c40) | Partially relational | Mfg lot/availability stub; helpdesk no company + unvalidated team/stage; proposal convert `uom_id: 1` |

**Correction vs prior adversarial docs ACL (D1/D2):** HTTP documents/folders/versions are **no longer org-wide fall-through**. `query_exec.rs:1073–1120` and `erp_subscriptions.rs` now apply owner/`created_by` filters. Residual: versions filter by `created_by` (not parent document owner); `read_access_ids` still unused in list SQL.

---

## 1. Cross-module relationship map (high-signal)

```text
Org → Company
  ├─ Contact ← partner_id (SO, PO, invoice, payment, project, ticket, proposal…)
  │     └─ tags/roles/phones — mixed Validated / Assumed
  ├─ Lead ──convert──► Contact + Opportunity ──convert──► SaleOrder → lines → invoice → payment
  ├─ PurchaseOrder → lines → StockPicking/Move → Quant ──bill──► AccountMove
  ├─ AccountMove → AccountMoveLine (account_id, partner_id, account_internal_type)
  │     └─ AccountPayment / PaymentTransaction → reconcile / allocate
  ├─ HrEmployee → Leave / Contract / Timesheet → ProjectTask → bill AR
  ├─ DocumentFolder → Document → DocumentVersion (ACL: owner / created_by)
  ├─ Workflow → Instance → Token → HumanTask → Candidates
  └─ AiReducerAllowlist → AiActionDraft → execute_whitelisted_draft
```

SpacetimeDB does **not** enforce FKs. Every edge is reducer honor-system. Classification used below: **Validated** · **Assumed** · **Hardcoded** · **Text** · **Coverage `0n`** · **Missing**.

---

## 2. Mutation provenance matrix (cross-domain P0/P1)

| Action | Field | Current source | Expected | Fallback | Risk | Fix |
|--------|-------|----------------|----------|----------|------|-----|
| `post_ledger_payment` | move lines | none | bank + AR/AP lines | Posted empty header | P0 | Reuse `post_payment` builder |
| `insert_draft_account_move_line` | `account_internal_type` | `format!("{:?}", t)` | lowercase / enum | `"Receivable"` | P0 | Normalize at insert |
| `reconcile_payment_with_invoice` | AR line match | `"receivable"` string | match stamped type | miss → fail | P0 | Same alphabet as insert |
| `register_payment_on_invoice` | invoice company | ignored | payment.company == invoice.company | none | P0 | Guard both moves |
| `convert_opportunity_to_sale_order` | currency / uom | opp / line | required FKs | `unwrap_or(1)` | P0 | Fail closed |
| `create_sale_order_line_internal` | product | product_id | Product in org | fabricate name | P0 | Err if missing |
| `create_sale_order` | partner_id | params | Contact org+company | exists+is_customer only | P0 | Scope check |
| PO confirm / return move | `lot_id` | hardcode | lot when tracked | `None` | P0 | Stamp + receive API |
| outbound validate dest | quant lot | `increase_quant…` | preserve move lot | forced `None` | P0 | Owned helper with lot |
| `assign_stock_picking` | reservation | state flip | `reserve_quantity…` | none | P0 | Call reserve or drop ATP claim |
| coverage mappers (many) | journal/account/uom/warehouse | form optional | required or omit | `?? 0n` | P0 | Fail closed |
| `approve_ai_action_draft` | allowlist | create-time only | re-check live | stale pending | P0 | Re-check on approve/execute |
| MO consume/finish | `lot_id` | hardcode | lot when tracked | `None` | P0 | Stamp or refuse |
| proposal convert | `uom_id` | hardcode | product UoM | `1` | P0 | Derive from product |
| helpdesk create | team/stage/sla | params | scoped FKs | raw insert | P0 | Validate org (+ company) |
| leave create | employee / leave_type | params | scoped FKs | soft | P1 | Find + company |
| expense create mapper | `accountId` | — | line account | forced `undefined` | P1 | Wire or derive |
| convert_lead | company_id | optional | operating company | `.ok()` → None | P1 | Fail if no company |
| FE clients | `operatingCompanyId` | hook | required | `?? 0n` | P1 | Never coerce 0 |

---

## 3. Missing or weak foreign-key usage (selected)

| Table | Field | Related | Current | Expected | Scope BE | UI | BE | Mig | Test |
|-------|-------|---------|---------|----------|----------|----|----|-----|------|
| account_move_line | account_internal_type | AccountType | Debug string | stable label/enum | N | N | Y | N | Y |
| account_move (ledger pay) | lines | account_move_line | missing | ≥2 balanced | — | N | Y | N | Y |
| sale_order | partner_id | contact | exists+customer | +org/company | N | Y | Y | N | Y |
| sale_order_line | product_id | product | ghost fabricate | hard fail | N | Y | Y | N | Y |
| opportunity | company_currency_id | currency | convert `1` | required | N | Y | Y | N | Y |
| lead | company_name | contact | free text | partner_id + snapshot | N | Y | Y | N | Y |
| stock_move | lot_id | stock_lot | often None | required if tracked | Partial | Y | Y | N | Y |
| purchase_return | location dest | stock_location | `stock_loc+2` | real FK | N | N | Y | N | Y |
| purchase_order | partner | contact | is_vendor only | +org | N | Y | Y | N | Y |
| rfq→po | rfq_id | purchase_rfq | origin/metadata | first-class FK | N | Y | Y | Y | Y |
| hr_leave | employee_id | hr_employee | soft | validated | N | Y | Y | N | Y |
| project_timesheet | employee_id | hr_employee | soft | validated | N | Y | Y | N | Y |
| project_timesheet | company_currency_id | currency | `0` | real FX currency | N | N | Y | N | Y |
| document_version | (ACL) | document | `created_by` filter | parent owner/share | Partial | N | Y | maybe | Y |
| ticket | team/stage/sla | helpdesk_* | unvalidated | scoped | N | Y | Y | N | Y |
| ticket | company_id | company | **absent** | company scope | — | Y | Y | Y | Y |
| ai_action_draft | company_id | company | stamped | company∈org | N | N | Y | N | Y |
| field_permission | resource | registry | free string | allowlisted key | N | Y | Y | N | Y |

---

## 4. Compiler-only / coverage-only fields

These exist primarily to satisfy generated `Create*Params`, coverage scripts, or Odoo-shaped schemas — not business provenance:

| Artifact | Pattern | Evidence |
|----------|---------|----------|
| `*-coverage-create-params.ts` | `?? 0n` on journal/account/uom/warehouse/homeCompany | expenses/purchasing/sales/hr/projects/subscriptions coverage mappers |
| `workflows-coverage-create-params.ts` | company from formData `?? 0n` | erp-shared coverage |
| `crm-params-merge.ts` | `stageId ?? 0n`, empty tagIds, default state | query-hooks |
| `sales-create-params.ts` | `orderLines: [] as …`, `as CreateSaleOrderParams` | FE cast |
| `subscriptions-revenue-params.ts` | `as unknown as …Params`, COGS→income/`0` | FE |
| `StockMoveLine` table | full schema, **zero insert path** | inventory/stock.rs |
| `InventoryValuation` table | public table, **zero mutators** | inventory/valuation.rs |
| Picking `show_*` / `has_*` / `display_lot_id` | literal defaults | PO confirm / stock validate |
| POL `move_ids` / `invoice_lines` | schema present, never maintained | purchasing |
| MO activity/message vectors | empty on create | manufacturing |
| Helpdesk `user_id: None` | hardcoded | tickets.rs |
| Trackers / Forensics | shells | no domain mutations |

**Rule:** coverage mappers must fail closed or stay out of production wire. Mapper-name coverage ≠ relational integrity.

---

## 5. Ignored useful fields (high value only)

| Field | Why it matters | Current |
|-------|----------------|---------|
| Expense `accountId` on create | GL correctness | forced `undefined` in mapper |
| Invoice AR account on payment | settle correct residual | first company AR/AP |
| SO fiscal / distinct ship-to / analytic | tax + logistics | form omits |
| Lead `partner_id` / source / campaign / tags | CRM attribution | free-text / unused |
| Opp `company_currency_id` | convert integrity | unused → magic `1` |
| Product `tracking` at PO confirm | lot moves | `has_tracking: false`, `lot_id: None` |
| Receive lot API | lot SKUs | mapper `{lineId, qty}` only |
| RFQ bid compare UX | sourcing integrity | `window.prompt` |
| Project analytic / task parent | PSA reporting | FE `undefined` / WBS `0` |
| Leave `manager_id` | approval routing | FE `undefined` |
| Helpdesk `partner_id` | ticket↔customer | mapper drops |
| Document `read_access_ids` | sharing | mutate-only; not in list SQL |
| Live AI allowlist at approve | revoke safety | create-time only |
| ImportJob `company_id` | tenant provenance | column absent |

---

## 6. Scope and integrity failures

1. **No engine FKs** — all relations are application-checked or not.
2. **Cross-company within org** — payment register/reconcile; SO partner; MO lifecycle; PO vendor; AI draft company stamp.
3. **Magic IDs** — `0`, `0n`, `1` for currency/UoM/accounts/warehouse/company.
4. **Ghost entities** — missing product becomes `"Product {id}"` on SO lines; return location `id+2`.
5. **String-typed accounting roles** — Debug `"Receivable"` vs matcher `"receivable"` (tests patch production never writes).
6. **Empty Posted moves** — `post_ledger_payment` marks Paid with zero lines.
7. **Lot identity destroyed** — inbound None; outbound dest strips lot; landed cost only hits `lot_id.is_none()` quants.
8. **ATP theater** — assign flips state without `reserve_quantity_at_location`.
9. **Update wipe** — PO line update forces `taxIds: []`.
10. **Documents share model incomplete** — owner/`created_by` pilot ACL; shares not queryable.
11. **Soft HR/PSA FKs** — employee/dept/job/leave_type/partner often unchecked.
12. **Approval/allowlist bypass** — AI pending drafts; subscription pay skips `PostPayment` gate.

---

## 7. Implementation plan

### P0 — Data corruption / tenant-isolation / false ledger

1. Normalize `account_internal_type` at insert (lowercase or enum); delete `patch_receivable_line_type` from production-faithful tests.
2. Build balanced lines in `post_ledger_payment`; company+org guards on register/reconcile.
3. Fail closed on missing product / currency / UoM; delete fabricate and `unwrap_or(1)`.
4. Stamp lot on inbound (PO/return/MO); outbound dest preserves lot; consume by lot; receive API accepts lot.
5. Reject `0n`/`0` required FKs in coverage and primary mappers; never `operatingCompanyId ?? 0n`.
6. Re-check AI allowlist (+ company∈org) on approve/execute.
7. Helpdesk: validate team/stage/sla/partner; Manufacturing: company guard on MO lifecycle + kill availability stub.

### P1 — Broken or misleading user actions

8. Scope-validate Contact/Product/Pricelist/Warehouse/Currency/Tax/Tag on create paths (CRM/Sales/Purchasing).
9. Wire expense `accountId`; stable expense `clientRequestId`; stop tax wipe on PO line update.
10. Lead partner picker; require currency before opp→SO convert; fail-closed lead convert without company.
11. Leave/timesheet/contract employee FK asserts; bill partner tied to project partner.
12. RFQ first-class FKs + non-prompt award UI; maintain POL `move_ids` / `invoice_lines`.
13. Map helpdesk `partnerId`; proposal product proof + UoM from product; BOM lines or block empty manufacture BOM.

### P2 — Incomplete relational usage

14. Document share query model (or document owner-only as permanent pilot policy).
15. Activity polymorphic target validation; fiscal tax FKs; currency/partner on deferred recognition.
16. FieldPermission resource registry validation; FormRole ↔ Role.id; workflow candidate ID validation.
17. Display/navigate related labels in lists (partner, product, lot) instead of stale text-only.

### P3 — Cleanup

18. Delete or implement `StockMoveLine` / `InventoryValuation` / dead `UpdateSubscription*` params.
19. Cull Odoo message/rating chrome fields or derive them.
20. Keep Trackers/Forensics/Distributor out of GREEN gates until mutations exist.

---

## 8. Required test plan (cohort)

```text
Given:
- Organization A and Organization B
- Company A1 and Company A2
- Related records in each scope
- User authorized only for Organization A / Company A1

When:
- User selects real related records and submits distinctive non-default values

Then (persisted query, not button success):
- Stored row contains exact selected FKs (no 0 / 1 / empty / fabricated ghosts)
- Related records belong to org A / company A1
- Cross-company IDs rejected
- Missing required relations rejected
- SO invoice → post_payment → register works WITHOUT receivable type patch
- post_ledger_payment produces ≥2 balanced lines
- Lot receive stamps lot; outbound dest retains lot
- Empty AI allowlist blocks approve of pending draft
- Retry does not duplicate (stable idempotency keys)
```

Domain suites must not use harness patches that paper over production stamps.

---

## Domain verdicts (completion standard labels)

| Domain | Label |
|--------|-------|
| Accounting + Expenses + Subs | **Unsafe for real ERP data** |
| CRM + Sales | **Compiler-complete but semantically incomplete** |
| Purchasing + Inventory | **Partially relational** (non-lot P2P pilot with restrictions) |
| HR + PSA + Documents | **Partially relational** |
| Platform / core | **Pilot ready with restrictions** |
| Secondary (cohort) | **Partially relational** |
| **Overall** | **Unsafe for real ERP data** |

---

## Agents

| Agent | Focus |
|-------|-------|
| [CRM+Sales](ba3d9ffe-912c-4dd5-a18d-f2b551fd25e7) | Lead→cash FK provenance |
| [P2P+Inventory](42044701-f34a-4fa9-8d6f-61d531733e5e) | PO/lot/quant/RFQ |
| [Accounting+Exp+Subs](d1b0984c-3456-4a03-a4b4-cff696ce7a8d) | JE/payment/expense/sub |
| [HR+PSA+Docs](9650c1b4-5d29-40e9-ba0a-7665bec23913) | Leave/timesheet/ACL |
| [Platform](45d22741-069a-4039-b4b7-382a30920632) | Auth/forms/workflow/AI |
| [Secondary](bcd3f1c6-b9fb-4f8c-96ce-c56e580e6c40) | Mfg/helpdesk/proposals/… |

---

```text
Audit only the assigned module domain per agent. Do not modify unrelated modules.
First produce the relationship map, mutation provenance matrix, and ranked implementation plan.
Use exact file and line evidence for every finding.
```
