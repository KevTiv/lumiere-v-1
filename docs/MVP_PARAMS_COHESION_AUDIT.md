# MVP params cohesion audit

Tracks whether user-facing reducers receive explicit caller-supplied values (form → mapper → hook → `/api/call`) instead of hardcoded literals or silent `None` in reducer bodies.

**Reference implementations:** `create_invoice_from_sale_order`, `create_bill_from_purchase_order`

**Related:** [MVP_WORKFLOW_CONTRACT.md](./MVP_WORKFLOW_CONTRACT.md) · [reducer-coverage-matrix.md](./reducer-coverage-matrix.md) · `.cursor/rules/lumiere-reducer-conventions.mdc`

---

## Audit rubric

| Layer | Pass | Fail |
|-------|------|------|
| **Backend params struct** | Trailing `*Params`; scope ids flat | Many entity fields as flat args or literals in insert/update |
| **Reducer body** | Only `id: 0`, ctx audit fields, derived-from-source values | Hardcoded journal/account/partner, magic defaults not in params |
| **Option-field registry** | Struct in `stdb-http-option-fields.json` when it has `Option<T>` fields | Missing entry → HTTP `{ none: [] }` gaps |
| **Frontend mapper** | `toCreate*Params` / `finalize*` builds full struct | Inline partial object, `as unknown as CreateXParams` |
| **Frontend form** | User-configurable fields exposed; templates for line shells | Env/server-resolved ids, action with no form |
| **Hook encoding** | `stdbParamsToJson(..., "StructName")` (+ nested structs) | `stdbParamsToJson(params)` without struct name on Option-heavy structs |
| **E2E** | `proven` UI path | `bff-assist` / `manual` without documented owner |

**Defer (OK):** ctx fields, derived SO/PO line amounts, template defaults via `emptyMoveLineParams`, action-only reducers (confirm/lock/cancel).

---

## Investigation method (per reducer, ~15 min)

1. Backend: read reducer `insert`/`update` — classify each field (params / ctx / derived / literal).
2. Grep reducer name under `frontend/` — hook, client, mapper, form config.
3. Cross-check struct vs `stdb-http-option-fields.json` and `REDUCER_PARAM_STRUCTS` in `stdb-params-json.ts`.
4. Confirm UI path works without BFF/env shortcuts.
5. Record one ledger row below.

### Useful commands

```bash
# Backend Create*Params structs
rg 'pub struct Create.*Params' spacetimedb/src --glob '*.rs'

# Frontend mappers
rg 'export function toCreate|ParamsFromForm' frontend/web/lib frontend/packages/erp-shared/src --glob '*.ts'

# Automated mapper coverage (Phase B/C)
cd frontend/web && pnpm exec tsx ../../scripts/check-params-mapper-coverage.ts --json

# Leaky partial payloads
rg 'as unknown as Create' frontend/web/app --glob '*.tsx'

# Hardcoded inserts (manual review)
rg '\.insert\(' spacetimedb/src --glob '*.rs' -l

# Reducer wiring matrix
cat docs/reducer-coverage-matrix.md
cat frontend/web/reducer-coverage-report.json
```

---

## Baseline metrics (2026-07-01)

| Metric | Count | Notes |
|--------|------:|-------|
| `Create*Params` structs (Rust) | **166** | `spacetimedb/src/**/*.rs` |
| `Create*` entries in option-fields JSON | **~147** | `stdb-http-option-fields.json` |
| Dedicated `toCreate*` / `*FromForm` mappers | **~88** | `frontend/web/lib` + `erp-shared` (see § tooling) |
| `REDUCER_PARAM_STRUCTS` (E2E helper) | **8** | `stdb-params-json.ts` |
| Form field definitions (UI configs) | **~1,500+** | 23 `*-form-configs.ts` modules |
| `as unknown as Create*` in web clients | **8** | calendar, documents, subscriptions (+ others TBD) |
| **Mapper coverage (automated)** | **53%** | 88 / 166 — `scripts/check-params-mapper-coverage.ts` |

---

## Phase A — MVP golden path (steps 3–12)

Status as of branch with `create_bill_from_purchase_order` params refactor.

| Step | Reducer | Params struct | Body literals | Form | Mapper | Hook encoded | E2E | Verdict | Owner / fix |
|------|---------|:-------------:|:-------------:|:----:|:------:|:------------:|:---:|---------|-------------|
| 3 | `create_contact` | ✅ `CreateContactParams` | ✅ params-only insert | ✅ `new-contact` | ✅ `toCreateContactParams` + `finalizeCreateContactParams` | ✅ `"CreateContactParams"` | proven — `mvp-lead-to-cash.spec.ts` | **Pass** | — |
| 4 | `create_lead` | ✅ `CreateLeadParams` | ✅ | ✅ `new-lead` (+ state select) | ✅ `toCreateLeadParams` + finalize | ✅ `"CreateLeadParams"` | proven — `mvp-lead-to-cash.spec.ts` (UI) | **Pass** | — |
| 5 | `convert_lead_to_customer` | ✅ `ConvertLeadParams` | ✅ | ✅ `convert-lead` modal | ✅ `toConvertLeadParams` | ⚠️ `stdbParamsToJson(params)` **without** struct name | proven — UI in lead-to-cash | **Pass*** | *Fix hook: pass `"ConvertLeadParams"` (registry exists) |
| 6 | `convert_opportunity_to_sale_order` | ✅ `ConvertOpportunityParams` | ✅ | ✅ `convert-opp-order` modal | ✅ `toConvertOpportunityParams` | ⚠️ no struct name; struct has no Option fields | proven — UI in lead-to-cash | **Pass** | Opportunity lines pre-convert still missing (separate gap) |
| 7 | `create_sale_order_line` | ✅ `CreateSaleOrderLineParams` | ⚠️ internal line init zeros (system) | ✅ `add-sale-order-line` | ✅ `toCreateSaleOrderLineParams` | ✅ `"CreateSaleOrderLineParams"` | proven | **Pass** | — |
| 8 | `confirm_sales_order` | N/A (action) | ✅ state transition only | ✅ entity action | N/A | N/A flat args | proven | **Pass** | — |
| 9 | `assign_stock_picking` / `validate_stock_picking` | N/A | ✅ | ✅ sales/inventory actions | N/A | N/A | manual | **Pass** | Full assign→validate E2E still open |
| 10 | `create_invoice_from_sale_order` | ✅ nested lines | ✅ template + derived | ✅ modal | ✅ `toCreateInvoiceFromSaleOrderParams` | ✅ nested `"AddAccountMoveLineParams"` | proven | **Pass** | Reference impl |
| 11 | `post_account_move` / `post_invoice` | N/A flat / partial | ✅ | ✅ invoice/bill detail modal Post | ✅ OutInvoice aborts post when COGS/inventory GL missing | flat args | proven (UI post in E2E) | **Pass** | Seed includes COGS + inventory valuation accounts |
| 12 | `create_payment` → `post_payment` → `register_payment_on_invoice` | ✅ `CreatePaymentParams` | ✅ | ✅ `new-account-payment` + `registerPaymentInvoicesForm` | ✅ `toCreatePaymentParamsFromManualForm` | ✅ `"CreatePaymentParams"` | proven | **Pass** | Golden E2E: UI create → post → register |

### Phase A summary

| Verdict | Count | Steps |
|---------|------:|-------|
| **Pass** | 9 | 3, 4, 5, 6, 7, 8, 9, 10, 12 |
| **Pass*** (minor gaps) | 2 | 5 hook encoding, 11 post UI/E2E |
| **Partial** | 0 | — |
| **FAIL** | 0 | — |

**MVP blockers (params cohesion):** none — Phase A complete for params cohesion.

---

## Phase B — Procure-to-pay (secondary MVP path)

| Step | Reducer | Params struct | Form | Mapper | Hook | E2E | Verdict | Notes |
|------|---------|:-------------:|:----:|:------:|:----:|:---:|---------|-------|
| Create PO | `create_purchase_order` | ✅ `CreatePurchaseOrderParams` | ✅ `new-purchase-order` | ✅ `toCreatePurchaseOrderParams` | ✅ `"CreatePurchaseOrderParams"` | proven | **Pass** | — |
| Confirm PO | `confirm_purchase_order` | N/A | ✅ action | N/A | flat | proven | **Pass** | — |
| Vendor bill | `create_bill_from_purchase_order` | ✅ nested lines | ✅ modal | ✅ `toCreateBillFromPurchaseOrderParams` | ✅ nested encoding | proven | **Pass** | — |
| Post bill | `post_invoice` | N/A | ✅ accounting bills detail | see step 11 | flat | proven | **Pass*** | Same as step 11 |

---

## Phase C — Module sweep backlog

Investigate in tier order. **Status = not yet audited** unless noted.

| Tier | Module | Forms (fields≈) | Mappers≈ | Risk | Priority actions |
|------|--------|----------------:|---------:|------|------------------|
| 1 | **Accounting** | 287 | 27+ | Low–medium | Spot-check `bill_timesheets`, `create_payment`, workflow reducers |
| 1 | **CRM** | 125 | 4 + merge | Low | Fix convert hook struct names; ~~opportunity lines UI~~ (Wave 4) |
| 1 | **Sales** | 119 | 4 + logistics | Medium | **SO line form** (P0); delivery actions |
| 1 | **Inventory** | 241 | 12 ext | Medium | Compare inline client vs `inventory-ext-params` |
| 2 | **Purchasing** | 117+ | 1 + inline | Medium | PO create mapper; bill **done** |
| 2 | **HR** | 71 | 6 | Medium | Full form↔struct diff |
| 2 | **Helpdesk** | 34 | 4 | Medium | — |
| 2 | **Projects / Expenses** | 46 / 31 | 2 / 2 | Medium | — |
| 3 | **Manufacturing** | 29 | 0 (inline) | **High** | `manufacturing-client` inline params |
| 3 | **Documents** | 50 | 0 | **High** | 8× `as unknown as Create*` casts |
| 3 | **Subscriptions** | 73 | 0 | **High** | inline + casts |
| 3 | **Calendar** | 8 | 0 | High | casts present |
| 3 | **IoT / Workflows / Messages / POS / Proposals** | 33–121 | thin | High | Proposals uses flat Option arg indices |

---

## Hook encoding gaps (fix in same PR as mapper)

These reducers are in `REDUCER_PARAM_STRUCTS` but hooks omit the struct name today:

| Reducer | Registry | Hook location | Fix |
|---------|----------|---------------|-----|
| `convert_lead_to_customer` | ✅ | `crm.ts` `useConvertLeadToCustomer` | `"ConvertLeadParams"` — **fixed** |
| `convert_opportunity_to_sale_order` | ✅ | `crm.ts` | `"ConvertOpportunityParams"` — **fixed** |
| `create_purchase_order` | ✅ `CreatePurchaseOrderParams` | `purchasing.ts` | `"CreatePurchaseOrderParams"` + `toCreatePurchaseOrderParams` — **fixed** |

---

## Anti-patterns found (fix or track)

| Pattern | Example | Status |
|---------|---------|--------|
| Server-resolved journal/account ids | `purchaseBillJournalId` on purchasing page | **Fixed** → modal |
| PO state `Approved` vs backend `Purchase` | Bill action, dashboard filters | **Fixed** — bill action + dashboard spend filter use `Purchase` |
| One-click bill loop with `new Date()` | Old PO create-bill action | **Fixed** → modal |
| E2E BFF for UI gaps | `post_account_move` | **Fixed** — UI post in lead-to-cash + procure-to-pay |
| Inline `handleFormSubmit` payloads | `createPurchaseOrder`, manufacturing, documents | **Open** — Phase B/C |
| `postInvoice` COGS/inventory `?? 0` | `accounting-client.tsx` `postDraft` | **Fixed** — OutInvoice/OutRefund toast + abort when chart lacks COGS/inventory |

---

## MVP exit criteria (params cohesion)

- [x] Phase A: zero **FAIL** rows (step 7 resolved)
- [x] Step 12 **Partial** resolved (payment in golden path or explicit bff-assist + owner)
- [x] All Phase A workflow reducers with Option fields use struct-name encoding in hooks
- [x] Workflow bill/invoice reducers produce balanced draft moves (debit = credit)
- [x] `mvp-lead-to-cash.spec.ts` uses UI for steps 7, 11, and 12
- [x] P2P: `create_bill_from_purchase_order` E2E step added (`mvp-procure-to-pay.spec.ts`)
- [x] `MVP_WORKFLOW_CONTRACT.md` vendor bill frontend route updated to `/purchasing`

---

## Recommended execution order

| Priority | Task | Effort |
|----------|------|--------|
| **P0** | Sale order line: form config + `toCreateSaleOrderLineParams` + hook struct name + E2E UI step | 1–2 days |
| **P0** | ~~Payment golden path: `create_payment` form cohesion + register step in E2E~~ | Done (Track 2B) |
| **P1** | Hook struct-name fixes (convert lead, SO line, create PO) | 2 hours |
| **P1** | `toCreatePurchaseOrderParams` extract from purchasing-client | 4 hours |
| **P1** | P2P E2E: bill-from-PO via modal | 4 hours |
| **P2** | Tier 3 module audit (documents/subscriptions/manufacturing casts) | 1 sprint |
| **P2** | Script: diff Rust `Create*Params` fields vs TS mapper return type | 1 day |

---

## Deep investigation — P0 blockers (field-level)

### Step 7: `create_sale_order_line`

| Layer | Status | Evidence |
|-------|--------|----------|
| Backend struct | ✅ | `CreateSaleOrderLineParams` — 17 fields, 8 `Option` (`spacetimedb/src/sales/sales_core.rs:30–47`) |
| Reducer body | ✅ defer OK | Internal insert sets qty_* / invoice_status / derived amounts (`sales_core.rs:377–419`); only `id: 0`, ctx, derived |
| Option registry | ✅ | `stdb-http-option-fields.json:1684–1692` |
| Form | ✅ | `addSaleOrderLineForm` in `sales-form-configs.ts`; wired on `order-lines` tab (`sales-client.tsx:1049–1056`) |
| Mapper | ✅ | `toCreateSaleOrderLineParams` in `sales-create-params.ts` |
| Hook | ✅ | `useCreateSaleOrderLine` uses `stdbParamsToJson(p, "CreateSaleOrderLineParams")` |
| E2E | ✅ UI | `mvp-lead-to-cash.spec.ts` — `openEntityCreate` + `add-sale-order-line` form |

**Implementation blueprint:** Copy `addPurchaseOrderLineForm` → `addSaleOrderLineForm`; wire like `createInvoiceFromSaleOrderForm` modal or tab `createForm`; mapper returns full struct with explicit defaults for non-form fields.

### Step 12: `create_payment` → `post_payment` → `register_payment_on_invoice`

| Layer | Status | Evidence |
|-------|--------|----------|
| `CreatePaymentParams` | ✅ | 3 Options: `date`, `ref`, `memo` (`payments.rs:49–60`) |
| Manual payment form | ✅ | `newAccountPaymentForm` (`accounting-form-configs.ts:725+`) |
| Manual mapper | ✅ | `toCreatePaymentParamsFromManualForm` (`accounting-create-params.ts:904+`) |
| Invoice mapper | ⚠️ dead | `toCreatePaymentParamsFromInvoice` — **zero UI callers** |
| Hook JSON | ✅ | `paymentParamsToJson` → `stdbParamsToJson(params, "CreatePaymentParams")` |
| Register UI | ✅ partial | Requires **posted** payment; `pay-link` opens `registerPaymentInvoicesForm` (`accounting-client.tsx:1518–1528`) |
| E2E | ✅ proven | `mvp-lead-to-cash.spec.ts` — UI create → `entity-action-pay-post` → `entity-action-pay-link` → register modal |

**Minimum golden-path fix:** ~~E2E steps — create payment (UI) → post → register invoice ids; fix `paymentParamsToJson` struct name in same PR.~~ Done (Track 2B).

### Reference parity: invoice-from-SO (step 10 PASS)

```
Form (createInvoiceFromSaleOrderForm)
  → toCreateInvoiceFromSaleOrderParams + emptyMoveLineParams templates
  → useCreateInvoiceFromSaleOrder nested stdbParamsToJson(..., "AddAccountMoveLineParams")
  → E2E proven (mvp-lead-to-cash.spec.ts:143–158)
```

---

## Sub-agent execution map

| Wave | Track handle | Mission section | Depends on | Est. |
|------|--------------|-----------------|------------|------|
| 1 | `[so-line-ui]` | mvp-params-cohesion-mission.md § Track 1A | — | 1–2 d |
| 1 | `[hook-encoding]` | § Track 1B | — | 2 h |
| 2 | `[e2e-so-line]` | § Track 2A | 1A, 1B | 4 h |
| 2 | `[e2e-payment]` | § Track 2B | 1B | 1 d |
| 3 | `[po-mapper]` | § Track 3A | 1B | 4 h |
| 3 | `[p2p-e2e]` | § Track 3B | 3A, bill modal done | 4 h |

**Coordinator doc:** [.cursor/plans/mvp-params-cohesion-mission.md](../.cursor/plans/mvp-params-cohesion-mission.md)

**Spawn order:** Wave 1 tracks **1A + 1B in parallel** → gate → Wave 2 **2A + 2B in parallel** → optional Wave 3.

---

## Contract ↔ E2E drift (fix in Wave 2)

| Step | Contract E2E | Actual spec | Action |
|------|----------------|-------------|--------|
| 4 | `proven` | UI `new-lead` with Qualified state | **Aligned** |
| 5 | `proven` | UI `convert-lead` modal | **Aligned** |
| 6 | `proven` | UI `convert-opp-order` modal | **Aligned** |
| 7 | `proven` | UI `add-sale-order-line` | **Aligned** |
| 11 | `proven` | UI invoice detail Post | **Aligned** |
| 12 | `proven` | UI create → post → register | **Aligned** |

---

## Ledger changelog

| Date | Change |
|------|--------|
| 2026-07-01 | Initial audit; Phase A pre-filled from codebase grep; `create_bill_from_purchase_order` marked Pass |
| 2026-07-01 | Wave 3: `toCreatePurchaseOrderParams`, P2P E2E, PO dashboard `Purchase` filter, `internalType` in account-accounts field policy |
| 2026-07-04 | Wave 3 gate green: `E2E_CLEAR_DB=1 make e2e-p2p`; Makefile `e2e-p2p` + `e2e-mvp-golden` |
| 2026-07-05 | Phase B/C tooling: `scripts/check-params-mapper-coverage.ts` + CI floor in `params-cohesion.yml` (baseline **53%**, 88/166 mapped) |

---

## Tooling

Automated mapper coverage diff for Phase B/C regression gates.

### `scripts/check-params-mapper-coverage.ts`

Compares Rust `Create*Params` structs under `spacetimedb/src` against frontend mapper exports in `frontend/web/lib` and `frontend/packages/erp-shared/src`.

**Recognized mapper patterns:**

- `export function toCreate*Params` (including `*ParamsFromManualForm` variants)
- `export function *ParamsFromForm` (e.g. `pickingWaveCreateParamsFromForm`)
- `export function buildCreate*Params` (e.g. subscription revenue builders)

**Usage:**

```bash
# Human-readable report
cd frontend/web && pnpm exec tsx ../../scripts/check-params-mapper-coverage.ts

# JSON for scripts / CI artifacts
cd frontend/web && pnpm exec tsx ../../scripts/check-params-mapper-coverage.ts --json

# Include mapped struct → mapper locations
cd frontend/web && pnpm exec tsx ../../scripts/check-params-mapper-coverage.ts --json --verbose

# CI floor (exit 1 when below threshold)
cd frontend/web && pnpm exec tsx ../../scripts/check-params-mapper-coverage.ts --min-coverage 53
```

**Output shape:**

```json
{
  "totalStructs": 166,
  "mappedCount": 88,
  "coveragePct": 53,
  "unmapped": ["CreateAccountAssetParams", "..."]
}
```

**CI:** `.github/workflows/params-cohesion.yml` runs on PR/push when Rust or mapper paths change. Floor **53%** (2026-07-05 baseline); target **70%** emits a warning annotation via `--warn-coverage 70`.

**Thresholds ([params-cohesion-v2 mission](../.cursor/plans/params-cohesion-v2-mission.md)):**

| Level | Coverage | CI behavior |
|-------|----------|-------------|
| Floor | 53% → raise toward 55%+ as mappers land | `exit 1` on PR |
| Target | 70% | warning |
| Stretch | 85% | backlog |
