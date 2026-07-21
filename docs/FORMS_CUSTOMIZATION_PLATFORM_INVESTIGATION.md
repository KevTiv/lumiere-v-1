# Forms & Customization Platform — Investigation

Current-state assessment of Lumiere forms / custom fields / configuration against a NetSuite *quality* bar (integrated ops/finance, multi-entity, drill-down, workflow controls, localization, extensibility, lifecycle, integrations) — not a feature-copy checklist.

**Investigation date:** 2026-07-21  
**Implementation update:** 2026-07-21 — pilot hardening + dual-path collapse + competitive schema: server EAV validation + def binding + posted `account_move` guards; `publish_form_configuration` + field CAS; live Settings → Custom Fields; CRM/sales/purchasing/accounting `ModuleView`/`RuntimeFormModal` STDB merge (`preferStdbVisibility`); invoice create modal loads `custom:*` + EAV persist; `config_version` on `form_config`; `visibility_json` + ModularForm `visibleWhen`; `form_field_label` + `set_form_field_label`; `SupportedLanguage` includes `pt-BR` (chrome falls back to `en`); E2E `persists custom field value to EAV on CRM lead create`.

**Method:** Source-traced inventory. “Verified” means present in code. Domain/E2E test names are listed as *existence*; this document does not claim those suites were executed as part of this investigation unless noted under Validation.

**Verdict:** Lumiere has a real **org-scoped form metadata + EAV values** stack (`FormConfig` / `FormConfigField` / `FormRoleConfig` / `FormFieldLabel` / `UserCustomField` / `RecordCustomFieldValue`), admin settings UI, registry publish, and STDB-backed runtime forms for CRM → sales → purchasing → accounting. Remaining gaps vs the NetSuite quality bar are mostly **differentiating**: custom records, sandbox→prod packages, form↔workflow, monitoring, scripts.

**Quality benchmark (not a spec):** Oracle NetSuite’s platform bar emphasizes custom records/forms, declarative validation, role-aware views, SuiteScript extensibility, no-code workflows, SuiteApp lifecycle (sandbox, promote, upgrade compatibility), monitoring, and application distribution ([NetSuite Platform Overview](https://www.netsuite.com/portal/platform/developer.shtml); [Custom Records](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2788750.html); [SuiteCloud Development Framework](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2788750.html)). Lumiere is judged on whether tenant customization can meet that *depth of control, lifecycle, and safe multi-entity use* — including translated labels and pack-aware forms for Oceania / Southern Africa / Brazil–Southern Cone / Maritime SEA — not on SuiteApp feature parity.

**V1 roadmap reconciliation:** `docs/V1_ROADMAP.md` does **not** currently call out a Forms & Customization Platform wedge. Treat this investigation as the source of truth for platform depth until a roadmap claim is added. Adjacent plans: `docs/plans/vertical-lite-packs-plan.md` (packaging intent only).

---

## 1. Verified inventory

### 1.1 Tables (`spacetimedb/src/forms/`)

| Area | Tables (accessor) | File | Notes |
|------|-------------------|------|-------|
| Form identity | `form_config` | `forms/mod.rs` | Org-scoped; `module_id` + `form_id`; `config_version`; active/system flags; no `company_id` |
| Field definitions | `form_config_field` | same | Layout via `order` / `width` / `section_id`; `visibility_json`; nested options/validation/AI as JSON strings |
| Field labels (i18n) | `form_field_label` | same | Per-field locale rows (`en`, `pt-BR`, …); upsert via `set_form_field_label` |
| Role overlays | `form_role_config` | same | Enabled/required field lists + prompts as JSON strings; `role_id: String` |
| Personal custom fields | `user_custom_field` | same | Per-user defs; `field_id` must be `custom:*`; full def in `field_data_json` |
| Record values (EAV) | `record_custom_field_value` | same | `(organization_id, company_id, model, record_id, field_key)` + `value_json`; index `by_org_company_record` |
| Custom records | — | — | **Absent** |
| Validation rule entities | — | — | **Absent** (embedded `FieldValidation` JSON only) |
| Layout/section entities | — | — | **Absent** (`section_id` string on fields) |
| Computed / formula fields | — | — | **Absent** |
| Config packages / promote | — | — | **Absent** (version counter present; no sandbox package tables) |

**Supporting types (not tables):** `FieldType`, `FieldWidth`, `FieldOption`, `FieldValidation` in `forms/mod.rs`.

**Sibling:** `forms/migrations.rs` — `seed_organization_form_configs` / `migrate_all_organizations`. Wired from org bootstrap (`core/organization.rs`) and `core/migrations.rs`.

### 1.2 Backend reducers

| Group | Reducers | Notes |
|-------|----------|-------|
| Form config | `create_form_configuration`, `initialize_default_form_configs` | Create + seed journal (+ forensic in init) |
| Fields | `add_form_field`, `update_form_field`, `delete_form_field` | System fields cannot be deleted |
| Roles | `set_form_role_config` | Upsert role overlay |
| User custom fields | `add_user_custom_field`, `delete_user_custom_field` | No `update_user_custom_field` |
| EAV values | `set_record_custom_field_values`, `delete_record_custom_field_values` | Prefix `custom:`; model `write` permission |
| Seed / migrate | `seed_organization_form_configs`, `migrate_all_organizations` | Non-journal modules mostly warn stubs |
| Read stubs | `get_form_configuration`, `get_organization_form_configs` | Log/count only — **not** a read API |

**Absent as reducers** (coverage stubs only): `update_form_configuration`, `delete_form_configuration`, `update_user_custom_field`.

**Auth / audit (verified):**

- Config mutators: `check_permission(..., "form_configuration", "create"|"update"|"delete")`
- Values: `check_permission(..., &params.model, "write")`
- All listed mutators call `write_audit_log_v2` (often thin metadata, sparse before/after JSON)

### 1.3 Subscriptions & query resources

| Channel | Tables | Evidence |
|---------|--------|----------|
| WS resource `form-configuration` | `form_config`, `user_custom_field` only | `frontend/packages/stdb/src/queries/erp-subscriptions.ts`; `crates/stdb-auth/src/erp_subscriptions.rs` |
| HTTP query | `form-configs`, `form-config-fields`, `form-role-configs`, `user-custom-fields`, `record-custom-field-values` | `query-registry.ts`; fields/roles via two-step filter in api-server |

Child tables (`form_config_field`, `form_role_config`, EAV) are **intentionally omitted** from the WS resource (SQL `IN (SELECT …)` limits — see `docs/guides/spacetimedb-http-sql-limitations.md`). Runtime loads them via `useFormConfiguration` → `stdbBrowserQuery`.

### 1.4 UI operations

| Surface | Path | Live STDB? |
|---------|------|------------|
| Settings → Form config | `unified-form-config-settings.tsx` | **Yes** — seed, push registry, field CRUD, role config |
| Settings → Custom fields | `user-custom-fields.tsx` | **No** — local `sampleUserCustomFields` mock |
| Legacy local editor | `form-config-settings.tsx` | In-memory only |
| Runtime modal | `runtime-form-modal.tsx` + `use-runtime-form-modal-config.ts` | Merges static `FormConfig` with STDB |
| Merge / layout | `lib/runtime-form-config.ts` | STDB overrides labels/visibility; appends unmatched fields |
| Registry defaults | `forms/config/registry.ts` + `forms/config/modules/*.config.ts` | Client-side defaults (CRM, sales, inventory, …) |
| Static ModularForm configs | `lib/*-form-configs.ts` | Primary create/edit path across modules |
| EAV persist helper | `frontend/web/lib/persist-record-custom-fields.ts` | Maps `metadata` `custom:*` → reducer |
| Wired EAV callers | `crm-client.tsx`, `sales-client.tsx`, `purchasing-client.tsx` | After create |
| AI assist | `ai-gateway/.../forms.rs`, `app/api/ai/forms/{suggest,validate}` | Suggest/validate only |

Docs: `docs/guides/form-configuration.md`, `docs/api/form-configuration.md` (API doc omits EAV tables/reducers).

### 1.5 Tests

| Layer | File | Coverage |
|-------|------|----------|
| Unit | `forms/config/types.test.ts` | Parse fields/roles, role filter, `custom:` merge |
| Unit | `forms/hooks/use-form-config.test.tsx` | Hook load/filter (mocked) |
| Unit | `lib/ai-form-schema.test.ts` | AI schema sanitization |
| E2E | `parity-phase2-forms-mutations.spec.ts` | Add/delete custom field on CRM lead via settings |
| E2E helpers | `tests/e2e/helpers.ts` | Form-config open/seed/add/delete helpers |
| Backend domain | — | **Absent** — no `spacetimedb/tests` for form_config / EAV |
| E2E for EAV persist | — | **Absent** — no assertion on `set_record_custom_field_values` |

### 1.6 Storage model verdict

**Hybrid: normalized defs + EAV values + JSON blobs. Not generated per-tenant schemas.**

| Layer | Model | Citation |
|-------|-------|----------|
| Field definitions | Relational parent/child + JSON columns (`options_json`, `validation_json`, …) | `FormConfigField` |
| Role overlays | Relational + JSON list columns | `FormRoleConfig` |
| User personal defs | Relational + `field_data_json` blob | `UserCustomField` |
| Dynamic values | EAV rows with `value_json` | `RecordCustomFieldValue` |
| Dual path | Entity `metadata: Option<String>` often carries `custom:*` until/alongside EAV | Module clients + `persistCustomFieldsToEav` |

---

## 2. Gap matrix

| Capability | Status | Evidence / why |
|---|---|---|
| Custom fields (definition) | **Partial** | Org fields via `FormConfigField`; seeds incomplete; dual TS registry authority |
| Custom field values on records | **Partial** | EAV + persist helper on 3 modules; no def/type bind; no posted-doc guard |
| Custom records | **Absent** | No tables/reducers for arbitrary entity types |
| Form layouts / sections / order | **Partial** | `order` / `width` / `section_id`; no section entity; production often static ModularForm |
| Validation rules (declarative) | **Partial** | Stored JSON; client Zod subset; **no** server enforcement; `pattern` unused client-side |
| Computed / formula fields | **Absent** | No formula type or server compute path |
| Conditional visibility | **Absent** | Role enabled lists only — not field-dependent show/hide |
| Role-specific views / forms | **Partial** | `FormRoleConfig` toggles enabled/required; not alternate layouts |
| Translated labels | **Unsuitable** | Static forms use `t(...)`; STDB stores one `label`; i18n pack is `en` only |
| Tenant-specific configuration | **Partial** | Org-scoped defs; values company-scoped; no company form variants |
| Configuration versioning | **Absent** | `updated_at` only; no publish/rollback/CAS |
| Package promotion (sandbox → prod) | **Absent** | Vertical packs plan-only |
| Sandbox testing of config | **Absent** | No dry-run / sandbox DB for forms |
| Upgrade compatibility | **Partial** | `is_system` + idempotent seed; no custom-field upgrade matrix |
| Form-triggered no-code workflows | **Absent** | Workflow engine exists; no form-submit triggers |
| SuiteApp-like distribution | **Absent** | Planned vertical packs only |
| Monitoring of customizations | **Absent** | Audit rows only; no usage/health UI |
| Scripts/plugins on forms | **Absent** | AI gateway is not in-DB extensibility |

**Cross-cutting unsuitable model:** NetSuite treats customization as **tenant metadata that drives all clients**. Lumiere often falls back to **compile-time TS** (`useDefaultIfMissing` → `getDefaultFormConfig`) plus a second ModularForm stack — DB customizations are not the single source of truth.

---

## 3. Required invariants

### Accounting
1. Custom field **values must never mutate** posted GL / immutable documents (`AccountMove` posted state, draft-only line edits). Today `set_record_custom_field_values` has **no** posted-state check — must add (or forbid EAV writes on posted models).
2. Custom fields must be **orthogonal to balances** — never drive COGS/tax/AR amounts unless a separate audited posting path exists.
3. Entity `metadata` JSON must not be confused with EAV as the authoritative store for drill-down/reporting.

### Authorization
1. **Define** config: `form_configuration` create/update/delete (existing pattern).
2. **Set values**: model `write` is necessary but not sufficient — must also verify field key is an enabled def for that form/model (or an allowed org custom field).
3. **Org isolation** on all config mutators; **company isolation** on all EAV writes.
4. Personal `user_custom_field` delete must remain sender-owned; org-shared custom fields need a distinct permission (today conflated with personal).
5. Never trust client-supplied `organization_id` / `company_id` without membership + permission (existing `check_permission` + company-in-org helpers).

### Audit
1. Every definition change and every value change must leave recoverable **before/after** snapshots (`write_audit_log_v2` with populated `old_values` / `new_values` / `changed_fields` per reducer conventions).
2. Config publish (bulk registry push) must audit as a single transactional action once a publish reducer exists.

### Concurrency
1. Form config edits today are **last-write-wins** via `updated_at` with no compare-and-swap — require optimistic concurrency (`expected_updated_at` or config version).
2. EAV upserts are last-write-wins per key; enforce unique natural key `(org, company, model, record_id, field_key)` if not already constrained.
3. Bulk client chains (`pushRegistryFormToDatabase`) must not leave partial schemas — prefer one transactional publish reducer.

---

## 4. Reference workflows & acceptance scenarios

### Reference workflows

| ID | Workflow | Happy path (target) |
|----|----------|---------------------|
| FW-01 | Org form bootstrap | Create org → seed form configs → admin opens Settings → Form config → sees module forms |
| FW-02 | Add org custom field | Admin adds `custom:region_code` to CRM lead form → field appears on create → value persists to EAV → appears on edit |
| FW-03 | Role-restricted form | Sales role sees subset; finance role sees additional required fields |
| FW-04 | Registry publish | Admin pushes registry form to STDB in one transaction → clients subscribe/query new layout |
| FW-05 | Posted-doc safety | Attempt to change custom fields on posted journal/invoice → rejected |
| FW-06 | Config promote | Sandbox org exports package → prod import with version bump → upgrade check passes |
| FW-07 | Localized labels | Admin sets `pt-BR` label for field → BR company user sees Portuguese label |
| FW-08 | Form → workflow | Required custom field missing blocks submit; on success may start approval workflow |

### Acceptance scenarios (≥10)

| # | Scenario | Priority | Pass criteria |
|---|----------|----------|---------------|
| AS-01 | Create form configuration for org | pilot-critical | Reducer succeeds; row visible via query; audit CREATE |
| AS-02 | Add non-system field with required validation | pilot-critical | Field stored; client shows required; **server** rejects empty value on EAV/set |
| AS-03 | Delete system field blocked | pilot-critical | Reducer returns error; field remains |
| AS-04 | Set role enabled/required lists | competitive | Role A cannot see field X; Role B must fill field Y |
| AS-05 | Persist `custom:*` on CRM lead create | pilot-critical | EAV row for `(model, record_id, field_key)`; survives reload |
| AS-06 | Reject EAV key without `custom:` prefix | pilot-critical | Reducer error (already present) |
| AS-07 | Reject EAV write without model write permission | pilot-critical | Reducer error |
| AS-08 | Reject EAV write on posted accounting document | pilot-critical | Reducer error (**gap today**) |
| AS-09 | Two admins concurrent field reorder | competitive | Second write with stale `expected_updated_at` fails (**gap today**) |
| AS-10 | User custom fields settings UI hits STDB | pilot-critical | No mock sample state; add/delete round-trips (**UI gap today**) |
| AS-11 | Cross-company isolation | pilot-critical | Company B cannot read Company A EAV values via query/subscription |
| AS-12 | Pattern validation enforced | competitive | Invalid pattern rejected server-side (**gap today**) |
| AS-13 | Conditional visibility | competitive | Field B hidden until Field A = X (**absent**) |
| AS-14 | Translated label for BR pack | competitive | `pt-BR` label rendered when company pack `br` + UI language `pt-BR` (**absent**) |
| AS-15 | Config package promote sandbox→prod | differentiating | Versioned package applied; rollback possible (**absent**) |
| AS-16 | Custom record CRUD | differentiating | New entity type with fields, list, permissions (**absent**) |

---

## 5. Localization matrix

UI i18n today: `SupportedLanguage = "en"` only (`frontend/packages/i18n/src/config.ts`). Country packs exist for tax/ID/address (`spacetimedb/src/core/country_pack.rs`) but are **not wired** to form field labels or validation messages.

| Concern | Oceania (AU / NZ) | Southern Africa (ZA) | Brazil / Southern Cone (BR / AR / CL) | Maritime SEA (SG / MY / ID / PH / TH) |
|---------|-------------------|----------------------|--------------------------------------|--------------------------------------|
| UI locale for form chrome | `en-AU` / `en-NZ` desired; **only `en` shipped** | `en-ZA` (+ optional Afrikaans later); **only `en`** | `pt-BR`, `es-AR`, `es-CL` required for competitive bar; **absent** | `en-SG`, `ms-MY`, `id-ID`, `th-TH`, `en-PH`; **absent** |
| STDB field labels | Single English `label` string — **unsuitable** for pack-aware tenants | same | same — CNPJ/CPF-oriented custom fields need Portuguese labels | same — SST/PPN custom fields need local labels |
| Country pack keys (verified in-tree) | `au`, `nz` | `za` | `br`, `ar`, `cl` | `sg`, `my`, `id`, `th`, `ph` |
| Pack-driven form validation | Address/tax ID via pack helpers on parties — **not** on form_config validation_json | same | NF-e/CNPJ fields as custom defs — **manual only** | e-invoice custom fields — **manual only** |
| Date / number formats on forms | Client locale formatting partial via browser; not pack-driven | same | Decimal comma conventions for BR/AR/CL — **not** form-platform owned | same |
| RTL / complex scripts | N/A | N/A | N/A | Thai script rendering OK in browsers; no form-specific tests |
| Config package language | Package metadata should declare supported locales — **absent** | same | same | same |

**Official / regulatory anchors for pack-aware forms (not implemented as form translations):**

| Market | Reference |
|--------|-----------|
| Australia | [ATO](https://www.ato.gov.au); ABN validation already in country pack |
| New Zealand | [IRD](https://www.ird.govt.nz); NZBN in pack |
| South Africa | [SARS](https://www.sars.gov.za) |
| Brazil | [Receita Federal](https://www.gov.br/receitafederal) — CNPJ/CPF in pack metadata |
| Argentina / Chile | Local AFIP / SII invoice customs via pack metadata stubs |
| Singapore / Malaysia / Indonesia / Thailand / Philippines | GST/SST/PPN/VAT codes seeded in `country_pack_tax_rule` |

---

## 6. SpacetimeDB architecture decision

### Decision summary

| Topic | Decision |
|-------|----------|
| Transactions | One reducer = one transaction. Keep field CRUD atomic. Add **`publish_form_configuration`** for registry push (config + fields + roles in one TX). Keep EAV multi-entry upsert in one reducer; add validation + posted guards inside it. |
| Subscriptions | Clients subscribe/query `form_config` (+ fields/roles by org), `user_custom_field` (org+user), `record_custom_field_value` (org+company, optionally record). Do not use `get_*` reducers for reads. Prefer expanding query layer until WS can include child tables safely. |
| Isolation | Schema **org-scoped**; values **company-scoped**. Add optional company override table when multi-entity form variants are required. |
| Scale / storage | **Keep EAV for tenant DIY values**; **keep normalized field tables for defs**. Avoid per-tenant typed SpacetimeDB tables (migration/auth explosion). Use typed extension tables only for productized vertical fields. |
| External boundaries | SpacetimeDB: schema, values, permissions, audit, deterministic validation. api-server: query projection / allowlists. Outside: package catalogue, sandbox→prod artifacts, blob assets. AI gateway: suggest/validate only — never authoritative schema. |

### Storage choice benchmark

| Model | Query | Index | Migration | Auth | Fit |
|-------|-------|-------|-----------|------|-----|
| **EAV** (`RecordCustomFieldValue`) | Weak for “all invoices where custom:X=Y” without value indexes | Have org/company/record index; need unique natural key + optional `(model, field_key)` | Soft — add defs without schema publish | Per-row company + model permission | **Keep for values** |
| **JSON on entity** (`metadata`) | Poor selective filter | Opaque | Easy | Tied to parent | Cache/display only — not sole store |
| **Typed extension tables** | Best for hot custom domains | Native columns | Hard (module publish) | Clear | Productized verticals only |
| **Generated per-tenant schemas** | Ideal query | Ideal | Catastrophic in SpacetimeDB publish model | Complex | **Reject** |

### Scale notes
- Index EAV unique natural key; consider btree on `(organization_id, company_id, model, field_key)` for reporting.
- Cap entries per `set_record_custom_field_values` call to bound WASM work.
- Form field tables stay small (admin metadata); do not denormalize entire forms into one JSON blob (hurts partial update + role merge).

---

## 7. Priorities

| Capability | Class | Rationale |
|------------|-------|-----------|
| Org custom field defs wired to CRUD forms (single runtime path) | **pilot-critical** | Extensibility without forking modules |
| EAV values validated + posted-safe + permission-bound to defs | **pilot-critical** | Data integrity / GL safety |
| Collapse STDB vs static ModularForm dual authority for pilot modules | **pilot-critical** | Customizations must actually show |
| Server-enforced declarative validation subset | **pilot-critical** | Client Zod is bypassable |
| Settings UI → live STDB for user/org custom fields | **pilot-critical** | Mock UI is a false product signal |
| Tenant clarity (org schema / company values; optional company overrides) | **pilot-critical** | Multi-entity ERP bar |
| Role-specific enabled/required forms across modules | **competitive** | SME admin/sales/ops separation |
| Translated labels (locale keys or per-locale label rows) | **competitive** | Multi-market; packs alone insufficient |
| Conditional visibility | **competitive** | Common ERP form UX |
| Config versioning + optimistic concurrency | **competitive** | Admin safety |
| Upgrade compatibility matrix for custom fields | **competitive** | Survive module publishes |
| Computed / formula fields | **differentiating** | After core EAV/auth |
| Custom records | **differentiating** | Large platform bet |
| Package promotion / sandbox config testing | **differentiating** | Partner/ISV motion |
| SuiteApp-like distribution (align vertical-lite packs) | **differentiating** | Later |
| Form-triggered workflows | **differentiating** | Wire after workflow triggers exist |
| Monitoring of customizations | **differentiating** | Ops maturity |
| Scripts/plugins on forms | **differentiating** | Highest risk; prefer workflows + AI gateway first |

---

## 8. Recommended build sequence (non-binding)

1. **Pilot hardening:** server validation on EAV; posted-doc guards; bind keys to defs; unique EAV key; fix custom-fields settings UI; E2E for persist. **Done.**
2. **Single runtime path:** STDB-backed `RuntimeFormModal` / merge for CRM → sales → purchasing → accounting. **Done** (invoice specialized modal also loads `custom:*` + EAV).
3. **Publish reducer + concurrency:** transactional registry push; `expected_updated_at`. **Done.**
4. **i18n labels:** `form_field_label` locale rows; `pt-BR` + `en` language codes; chrome still falls back to English pack. **Done (schema + merge); full pt-BR UI strings still open.**
5. **Platform depth (post-pilot):** versioning/promote packages, custom records, form→workflow triggers. Conditional visibility (`visibility_json` / `visibleWhen`) **shipped**; remaining items still open.

---

## 9. Search evidence for key absences

| Capability | Search / evidence |
|------------|-------------------|
| Computed fields | No formula/expression field type in `spacetimedb/src/forms` |
| Config versioning / packages | `config_version` on `form_config`; no promote / form package tables |
| Custom records | No `CustomRecord` / custom entity platform |
| Form i18n columns | Default `label` + `form_field_label` locale rows; UI chrome `en` + `pt-BR` (pt-BR falls back to en strings) |
| Backend form tests | `test_forms_custom_field_eav` in `spacetimedb/tests/platform/platform_smoke.rs` |
| Form→workflow | No `form_config` references under `spacetimedb/src/workflow` |

---

## 10. Related docs

- `docs/guides/form-configuration.md` — developer guide (partial vs this investigation)
- `docs/api/form-configuration.md` — API surface (incomplete vs EAV)
- `docs/guides/spacetimedb-http-sql-limitations.md` — why field/role tables are HTTP-query-only
- `docs/plans/vertical-lite-packs-plan.md` — future packaging intent
- Sibling NetSuite-bar investigations: `docs/*_INVESTIGATION.md` (workflow, expenses, HR, proposals, …)
