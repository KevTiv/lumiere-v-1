# Lumiere V1 Roadmap

**Status:** Validation-corrected plan (2026-07-05); implementation snapshot **2026-07-07**  
**Audience:** Engineering, pilot operators, coordinator agents  
**Not in scope:** Odoo parity, enterprise multi-entity consolidation at scale, full module breadth

---

## Product frame

**Lumiere V1** is an **AI-native ERP for small B2B** teams (5–200 people) who need lead-to-cash and procure-to-pay without a six-month Odoo implementation.

| Principle | Implication |
|-----------|-------------|
| **Wedge over breadth** | Ship 2–3 end-to-end workflows deeply; verify existing backend before greenfield UI |
| **AI as copilot, not autopilot** | Draft → approve → execute; guardrails before expanding allowlist |
| **Form → mapper → reducer** | Explicit params structs; no silent admin sessions or leaky TS casts |
| **Pilot-ready ops** | Auth hardening, E2E gates, runbooks — not feature checklists alone |

This is **not** an Odoo competitor. Compete on time-to-value, AI-assisted onboarding/import, and opinionated small-business workflows.

**Related docs:** [MVP_WORKFLOW_CONTRACT.md](./MVP_WORKFLOW_CONTRACT.md) · [MVP_PARAMS_COHESION_AUDIT.md](./MVP_PARAMS_COHESION_AUDIT.md) · [PILOT_RUNBOOK.md](./PILOT_RUNBOOK.md) · [SECURITY.md](./SECURITY.md)

---

## Validation summary (2026-07-07)

Codebase research corrected many "missing feature" claims. **Wave 1–3 tracks are implemented**; remaining V1 work is **gate verification** (E2E, session tests, metrics under load) and pilot ops polish.

| Area | Original claim | Validated state (2026-07-07) | V1 action |
|------|----------------|------------------------------|-----------|
| Auth | Session security gaps | **Done** — JWT-only identity, no server-token fallback, `auth-permission-enforcement.spec.ts` @p0 | **Verify** gate |
| Lead-to-cash | SO line E2E, delivery exceptions | **Done** — `mvp-lead-to-cash.spec.ts`, partial/cancel picking, invoice correction E2E | **Verify** gate |
| Params | Mapper cohesion | **Done** — 0 `as unknown as Create*` in module clients; CI floor 70% | **Verify** CI |
| Sales returns | RMA domain missing | **Done** — `return_order` tables/reducers, `mvp-sales-returns.spec.ts` | **Verify** gate |
| Purchasing | 3-way match missing | **Done** — `compute_line_match_state`, P2P mismatch E2E | **Verify** gate |
| Accounting | GL drilldown gap | **Done** — `AccountGlDrilldownPanel`, period close checklist, fiscal lock on `post_payment` | **Verify** gate |
| Import | Full wizard | **Done** — 30+ entities, templates, map/preview, duplicate detection | **Verify** gate |
| AI drafts | Hardcoded whitelist | **Done** — `AiReducerAllowlist` table, diff panel, Settings → AI allowlist admin, execution audit | **Verify** `mvp-ai-action-draft.spec.ts` |
| Ops | Metrics / backup | **Partial** — `/metrics` wired; `backup-stdb.sh` + runbook docs; staging in `ENVIRONMENT.md` | **Verify** counters under load |
| CRM duplicates | Detection / merge | **Backlog** — backend + UI exist; E2E still stub | Phase 4 |

### Validation summary (2026-07-05) — historical

Codebase research corrected many "missing feature" claims. Use **build** vs **verify/polish** when prioritizing.

| Area | Original claim | Validated state | V1 action |
|------|----------------|-----------------|-----------|
| Accounting | Bank recon, fixed assets, payment terms missing | **FALSE** — backend + `accounting-client.tsx` tabs exist | **Verify/polish** existing UI |
| Accounting | GL drilldown | **TRUE gap** — flat `GeneralLedgerView` only | **Build** `[accounting-close]` Phase 1 |
| Inventory | Locations, lot/serial, cycle count, replenishment | **TRUE** — dedicated Rust modules | **Verify/polish** UI wiring |
| Sales | Price lists, backorder | **TRUE** — `pricelists.rs`, backorder fields | **Verify/polish** |
| Sales | Returns / RMA | **TRUE gap** — no return order domain | **Build** `[sales-returns-rma]` |
| Purchasing | Vendor mgmt, landed costs, approvals | **TRUE** — `vendor_management.rs`, `landed_costs.rs`, approval gate | **Verify/polish** |
| Purchasing | 3-way match | **TRUE gap** — qty fields exist, no match layer | **Build** `[purchasing-3way-match]` |
| CRM | Duplicate detection | **TRUE gap** | Phase 4 backlog |
| CRM | Activity timeline | **PARTIAL** — `crm-record-chatter.tsx` message feed exists | Verify vs structured activities |
| Approvals | Unified inbox | **TRUE** — `approvals-client.tsx` + `approval_gate.rs` | **Verify/polish** |
| Import | Full wizard | **PARTIAL** — skill + 5-entity wizard + 59-entity API route | **Build** `[import-wizard-v1]` |
| AI drafts | Guardrails | **PARTIAL** — 3-reducer hardcoded whitelist, no diff preview | **Build** `[ai-guardrails]` |
| Auth | Session security | **TRUE gap** — server-token fallback, identity header trust | **Build** `[auth-hardening]` |
| Params | Mapper cohesion | **PARTIAL** — Phase A done; ~50% gap + 8 casts | **Build** `[params-cohesion-v2]` |
| Ops | Metrics / backup | **PARTIAL** — counters at 0, backup manifest-only | **Build** `[prod-ops]` |

---

## Wedges A–E

Each wedge maps to pilot buyer value. **P0** = must ship for V1; **Verify** = exists, needs QA/polish/E2E; **Backlog** = Phase 4.

### Wedge A — Lead-to-cash (CRM → Sales → Inventory → Accounting)

**Buyer promise:** Quote-to-cash for a small sales team with stock fulfillment and AR.

| Item | Type | Track / note |
|------|------|--------------|
| Golden path steps 3–12 | **Verify** | `mvp-lead-to-cash.spec.ts` — mostly `proven` |
| Step 7 direct SO line E2E | **Build P0** | `[lead-to-cash-gaps]` Phase 1 |
| Delivery exceptions (partial, backorder, cancel) | **Build P0** | `[lead-to-cash-gaps]` Phase 2 |
| Invoice correction / credit note ad-hoc | **Build P0** | `[lead-to-cash-gaps]` Phase 3 |
| Sales returns / RMA domain | **Build P0** | `[sales-returns-rma]` (Wave 2) |
| Opportunity lines, CRM pipeline | **Verify** | MVP coordinator tracks largely done |
| Params cohesion golden path | **Verify** | Phase A complete per audit |

### Wedge B — Procure-to-pay (Purchasing → Receipt → Vendor bill)

**Buyer promise:** PO → receive → bill → post with control.

| Item | Type | Track / note |
|------|------|--------------|
| Happy path P2P | **Verify** | `mvp-procure-to-pay.spec.ts` |
| Vendor management, landed costs, PO approvals | **Verify** | Backend + purchasing UI exist |
| 3-way match view + bill post guard | **Build P0** | `[purchasing-3way-match]` |
| `create_bill_from_purchase_order` params | **Verify** | Phase B pass in params audit |

### Wedge C — Accounting close & compliance

**Buyer promise:** Month-end close, VAT export, bank recon — without reimplementing Odoo.

| Item | Type | Track / note |
|------|------|--------------|
| Bank reconciliation | **Verify** | `bank_reconciliation.rs` + accounting tabs |
| Fixed assets & depreciation | **Verify** | `fixed_assets.rs` + UI actions |
| Payment terms | **Verify** | `payment_terms.rs` + UI |
| Financial statements / VAT report | **Verify/polish** | `ReportState` lifecycle; panel partial |
| GL per-account drilldown | **Build P0** | `[accounting-close]` Phase 1 |
| Period close checklist | **Build P0** | `[accounting-close]` Phase 2 |
| Fiscal lock on all post paths | **Build P0** | `[accounting-close]` Phase 3 (`post_payment` gap) |

### Wedge D — AI-native onboarding & automation

**Buyer promise:** Import CSVs safely; AI suggests actions humans approve.

| Item | Type | Track / note |
|------|------|--------------|
| Import mapping skill | **Verify** | `erp-skills/import_mapping/SKILL.md` |
| Guided import wizard (5 entities) | **Verify** | `guided-import-wizard.tsx` + `import.rs` |
| Mapping templates UI | **Build P0** | `[import-wizard-v1]` Phase 1 |
| Column editor + preview polish | **Build P0** | `[import-wizard-v1]` Phase 2 |
| Entity expansion + duplicate detection | **Build P1** | `[import-wizard-v1]` Phases 3–4 |
| AI action drafts create/approve/reject | **Verify** | Workflow steps 15–16 proven |
| Per-role AI allowlist + diff preview | **Build P0** | `[ai-guardrails]` |
| Dry-run simulation | **Backlog** | `[ai-guardrails]` Phase 4 stretch |

### Wedge E — Production readiness

**Buyer promise:** Safe to run a pilot tenant on maincloud or self-hosted stack.

| Item | Type | Track / note |
|------|------|--------------|
| Remove server-token session fallback | **Build P0** | `[auth-hardening]` Phase 1 |
| Identity header / DEV_MOCK gating | **Build P0** | `[auth-hardening]` Phase 2 |
| Permission E2E (post, validate, payment) | **Build P0** | `[auth-hardening]` Phase 3 |
| SECURITY.md accuracy | **Build P0** | `[auth-hardening]` Phase 4 |
| Metrics instrumentation | **Build P0** | `[prod-ops]` Phase 1 |
| Backup/export documentation | **Build P1** | `[prod-ops]` Phase 2 |
| Staging env documentation | **Build P1** | `[prod-ops]` Phase 3 |
| P0 E2E mandatory in CI | **Verify** | `[prod-ops]` Phase 4 + `.github/workflows/e2e-smoke.yml` |
| Pilot runbook | **Verify** | `PILOT_RUNBOOK.md` exists |

---

## Module plans (corrected)

### Accounting

| Capability | State | V1 |
|------------|-------|-----|
| Chart, journals, moves, invoices, payments | Shipped | Verify |
| Bank recon, fixed assets, payment terms | Shipped | Verify UI, no greenfield backend |
| VAT report lifecycle | Backend shipped, UI partial | Polish `[accounting-close]` Phase 4 |
| GL drilldown | **Gap** | Build |
| Period close UX | **Gap** | Build |

### Inventory

| Capability | State | V1 |
|------------|-------|-----|
| Warehouses / locations | Shipped (`warehouse.rs`) | Verify |
| Lot / serial tracking | Shipped (`tracking.rs`) | Verify |
| Cycle count, replenishment | Shipped | Verify reducer→UI |
| Fulfillment on SO | Golden path proven | Verify exception UI via `[lead-to-cash-gaps]` |

### Sales

| Capability | State | V1 |
|------------|-------|-----|
| SO, lines, confirm, invoice | Golden path proven | Verify |
| Price lists | Shipped | Verify |
| Backorder fields | Shipped | Polish exception UI |
| Returns / RMA | **Gap** | Build `[sales-returns-rma]` |

### Purchasing

| Capability | State | V1 |
|------------|-------|-----|
| PO, receive, bill | P2P proven | Verify |
| Vendors, landed costs, approvals | Shipped | Verify |
| 3-way match | **Gap** | Build |

### CRM

| Capability | State | V1 |
|------------|-------|-----|
| Contacts, leads, opps, convert | Golden path proven | Verify |
| Chatter / messages | Shipped | Verify |
| Duplicate merge | **Gap** | Phase 4 backlog |

---

## Cross-module foundations

These span all wedges. Several are **real P0 gaps**.

| Foundation | State | Track |
|------------|-------|-------|
| **Auth / session** | Critical fallback gap | `[auth-hardening]` |
| **Params cohesion** | Phase A done; ~50% mapper gap | `[params-cohesion-v2]` |
| **Form system** | 23 `FormConfig` modules in `packages/ui` | Convention — all new UI uses FormModal |
| **Reducer allowlist** | Global strict in prod | Verify; not per-role at gateway |
| **Audit log** | MVP P0/P1 largely done | Verify on new reducers |
| **Approvals inbox** | Shipped | Verify PO/SO gates |
| **Domain tests + E2E** | Harness wired | Expand with each wedge |
| **Import pipeline** | API + partial wizard | `[import-wizard-v1]` |
| **AI guardrails** | Draft flow proven; execution narrow | `[ai-guardrails]` |
| **Ops / metrics / backup** | Gaps | `[prod-ops]` |

---

## Execution order

### Wave 1 — Parallel (no cross-track file dependencies)

Run via [.cursor/skills/erp-v1-coordinator/SKILL.md](../.cursor/skills/erp-v1-coordinator/SKILL.md).

| Handle | Mission | Wedge |
|--------|---------|-------|
| `[auth-hardening]` | [auth-hardening-mission.md](../.cursor/plans/auth-hardening-mission.md) | E |
| `[lead-to-cash-gaps]` | [lead-to-cash-gaps-mission.md](../.cursor/plans/lead-to-cash-gaps-mission.md) | A |
| `[params-cohesion-v2]` | [params-cohesion-v2-mission.md](../.cursor/plans/params-cohesion-v2-mission.md) | Foundation |
| `[prod-ops]` | [prod-ops-mission.md](../.cursor/plans/prod-ops-mission.md) | E |

**Wave 1 gate:** unauthenticated API returns 401; `E2E_CLEAR_DB=1 make e2e-mvp-golden` green; zero `as unknown as Create*` in module clients; `/metrics` counters increment.

### Wave 2 — After Wave 1

| Handle | Mission | Wedge |
|--------|---------|-------|
| `[sales-returns-rma]` | [sales-returns-rma-mission.md](../.cursor/plans/sales-returns-rma-mission.md) | A |
| `[purchasing-3way-match]` | [purchasing-3way-match-mission.md](../.cursor/plans/purchasing-3way-match-mission.md) | B |
| `[accounting-close]` | [accounting-close-mission.md](../.cursor/plans/accounting-close-mission.md) | C |

**Wave 2 gate:** return workflow E2E; P2P mismatch scenario in spec; GL drilldown smoke; fiscal lock on `post_payment`.

### Wave 3 — After Wave 2

| Handle | Mission | Wedge |
|--------|---------|-------|
| `[import-wizard-v1]` | [import-wizard-v1-mission.md](../.cursor/plans/import-wizard-v1-mission.md) | D |
| `[ai-guardrails]` | [ai-guardrails-mission.md](../.cursor/plans/ai-guardrails-mission.md) | D |

**Wave 3 gate:** mapping template save/load; AI draft diff preview; expanded import entity list; `mvp-ai-action-draft.spec.ts` still green.

### Phase 4 backlog (post-V1)

| Item | Rationale |
|------|-----------|
| CRM duplicate detection / merge | No backend today |
| Manufacturing inline params + tier-3 module sweep | Partial — MO/BOM/workcenter mappers added |
| Mapper coverage → 85%+ | After `[params-cohesion-v2]` CI floor |
| CRM structured activity timeline (beyond chatter) | Product differentiation |
| Batch import rollback for more entity types | `contact` + `product` today; see `docs/IMPORT_ROLLBACK.md` |
| SSO / field-level permissions UI | `[reducer-ui-settings-auth]` |
| Server-side dashboard aggregations | Only if client-side slow |
| Multi-entity consolidation depth | Out of V1 product frame |

---

## Final V1 definition

V1 is **done** when a pilot tenant can:

1. **Onboard securely** — sign up, bootstrap org, invite users; no anonymous admin API sessions (`[auth-hardening]`).
2. **Run lead-to-cash** — CRM → SO → fulfill → invoice → payment with direct SO line and delivery exceptions proven in E2E (`[lead-to-cash-gaps]`); customer returns via RMA (`[sales-returns-rma]`).
3. **Run procure-to-pay** — PO → receive → bill with 3-way match visibility and bill post guard (`[purchasing-3way-match]`).
4. **Close the books** — drill GL by account, walk period-close checklist, post into open periods only (`[accounting-close]`); bank recon / fixed assets verified not regressed.
5. **Import masters safely** — wizard with templates, preview, duplicate warnings for contacts/products/vendors (`[import-wizard-v1]`).
6. **Use AI with guardrails** — drafts show diff preview; execution allowlist is configurable (`[ai-guardrails]`).
7. **Ship with confidence** — params mappers measured in CI (`[params-cohesion-v2]`); metrics live; runbook + staging documented (`[prod-ops]`); `make e2e-mvp-golden` mandatory on main.

**Explicit non-goals for V1:** Odoo module parity, portal/self-service returns, full 160-struct mapper coverage, native SpacetimeDB backup, hosted Grafana stack.

---

## Mission index

| Handle | Index | Mission |
|--------|-------|---------|
| `[auth-hardening]` | [auth-hardening.md](../.cursor/plans/auth-hardening.md) | [auth-hardening-mission.md](../.cursor/plans/auth-hardening-mission.md) |
| `[lead-to-cash-gaps]` | [lead-to-cash-gaps.md](../.cursor/plans/lead-to-cash-gaps.md) | [lead-to-cash-gaps-mission.md](../.cursor/plans/lead-to-cash-gaps-mission.md) |
| `[params-cohesion-v2]` | [params-cohesion-v2.md](../.cursor/plans/params-cohesion-v2.md) | [params-cohesion-v2-mission.md](../.cursor/plans/params-cohesion-v2-mission.md) |
| `[prod-ops]` | [prod-ops.md](../.cursor/plans/prod-ops.md) | [prod-ops-mission.md](../.cursor/plans/prod-ops-mission.md) |
| `[sales-returns-rma]` | [sales-returns-rma.md](../.cursor/plans/sales-returns-rma.md) | [sales-returns-rma-mission.md](../.cursor/plans/sales-returns-rma-mission.md) |
| `[purchasing-3way-match]` | [purchasing-3way-match.md](../.cursor/plans/purchasing-3way-match.md) | [purchasing-3way-match-mission.md](../.cursor/plans/purchasing-3way-match-mission.md) |
| `[accounting-close]` | [accounting-close.md](../.cursor/plans/accounting-close.md) | [accounting-close-mission.md](../.cursor/plans/accounting-close-mission.md) |
| `[import-wizard-v1]` | [import-wizard-v1.md](../.cursor/plans/import-wizard-v1.md) | [import-wizard-v1-mission.md](../.cursor/plans/import-wizard-v1-mission.md) |
| `[ai-guardrails]` | [ai-guardrails.md](../.cursor/plans/ai-guardrails.md) | [ai-guardrails-mission.md](../.cursor/plans/ai-guardrails-mission.md) |

**Coordinator:** [.cursor/skills/erp-v1-coordinator/SKILL.md](../.cursor/skills/erp-v1-coordinator/SKILL.md)

**Predecessor (MVP):** [.cursor/skills/erp-mvp-coordinator/SKILL.md](../.cursor/skills/erp-mvp-coordinator/SKILL.md) — CRM lifecycle, audit P0/P1, domain tests (largely complete).

---

## Changelog

| Date | Change |
|------|--------|
| 2026-07-07 | Implementation snapshot: Waves 1–3 tracks landed; AI allowlist Settings UI; gate verification remains |
| 2026-07-05 | Initial validation-corrected V1 roadmap; 9 mission tracks; 3-wave execution |
