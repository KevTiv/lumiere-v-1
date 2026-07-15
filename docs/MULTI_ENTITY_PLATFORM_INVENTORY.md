# Multi-Entity Platform Inventory

Status snapshot for Lumiere SpacetimeDB platform capabilities (Wave 1–3). Use this as the canonical checklist when extending tenant governance, consolidation, or localization.

## Wave 1 — Tenant foundation (shipped)

| ID | Capability | Backend | Tests | UI / API |
|----|------------|---------|-------|----------|
| A1 | Organization ↔ company scope guards | `require_company_in_organization` on IC, consolidation, fiscal year | `run_tenant_isolation_tests` | Org settings |
| A2 | Country packs (AU/NZ/ZA/SG seeds) | `country_pack.rs`, `set_company_country_pack` | `run_country_pack_test` | Country pack toggles in org settings |
| A3 | Global migration ledger | `migrations.rs` v1 seeds packs on `init` | `run_all_platform_tests` | — |
| A4 | Intercompany + elimination | `intercompany.rs`, `consolidation.rs` | `run_accounting_ic_consolidation_test` | — |
| A5 | Delegated admin scope table | `delegated_admin_scope`, `grant_delegated_admin_scope` | — | Org settings (grant/revoke) |
| A6 | SoD conflict rules | `sod_conflict_rule`, `validate_sod_for_permissions` | `run_core_sod_test` | SoD rules in role settings |
| A7 | Retention purge | `execute_retention_purge` in `privacy.rs` | privacy tests | Org settings purge action |
| A8 | Period lock on invoice post | `ensure_accounting_period_open_for_date` in `post_invoice` | `run_accounting_period_lock_test` | — |

## Wave 2 — Governance & FX (shipped)

| ID | Capability | Backend | Tests | UI / API |
|----|------------|---------|-------|----------|
| A6+ | SoD enforced on `assign_role` | `assign_role` → `validate_sod_for_permissions` | `run_core_sod_test` (assign path) | — |
| A5+ | Delegated admin cannot grant org permissions | `ensure_delegated_admin_may_grant_permission` | `run_core_sod_test` | — |
| A9 | Field-level write enforcement | `ensure_resource_fields_writable` on `update_contact` | `run_core_sod_test` (field policy) | Field permissions editor (read); write rules via Casbin |
| A10 | FX revaluation runs | `fx_revaluation.rs`, `run_fx_revaluation`, `fx_revaluation_run` | `run_accounting_fx_revaluation_test` | Accounting FX revaluation tab |

## Wave 3 — UI & policy coverage (shipped)

| ID | Capability | Backend | Tests | UI / API |
|----|------------|---------|-------|----------|
| A6++ | SoD rule update/deactivate | `update_sod_conflict_rule` | `run_core_sod_test` (deactivate path) | Deactivate in role settings |
| A5++ | Delegated admin revoke | `revoke_delegated_admin_scope` | `run_core_sod_test` | Org settings scope list + revoke |
| A9+ | Field write on opportunities | `ensure_resource_fields_writable` on `update_opportunity` | `run_core_sod_test` (opportunity policy) | — |
| A10+ | FX rate quick-add from revaluation tab | `create_currency_rate` (existing) | — | FX panel rate modal |
| A7+ | Retention purge manual trigger | `execute_retention_purge` (existing) | privacy tests | Org settings purge button |

## Reducers & tables (Wave 2–3 additions)

### `run_fx_revaluation(organization_id, company_id, params: RunFxRevaluationParams)`

Posts a balanced journal entry for unrealized currency adjustments and records an `fx_revaluation_run` audit row.

### `create_sod_conflict_rule(organization_id, params: CreateSodConflictRuleParams)`

Defines mutually exclusive permission pairs enforced on role assignment and permission validation.

### `update_sod_conflict_rule(organization_id, rule_id, params: UpdateSodConflictRuleParams)`

Updates or deactivates an existing SoD conflict rule (`is_active`, permissions, description).

### `grant_delegated_admin_scope(organization_id, company_id, params: GrantDelegatedAdminScopeParams)`

Grants company-scoped admin rights to a user identity.

### `revoke_delegated_admin_scope(organization_id, scope_id)`

Deactivates a delegated admin scope row.

### Guards (internal)

- `ensure_delegated_admin_may_assign_role` — blocks owner/system roles for delegated admins
- `ensure_delegated_admin_may_grant_permission` — blocks `grant_permission` for delegated admins
- `ensure_resource_fields_writable` — Casbin `write` rules with `metadata.fields` allow-list

## Test reducers

| Reducer | Suite |
|---------|-------|
| `run_core_sod_test` | SoD validate, assign_role, delegated admin, field write (contact + opportunity), rule deactivate, scope revoke |
| `run_accounting_fx_revaluation_test` | FX revaluation balanced move |
| `run_accounting_ic_consolidation_test` | IC cross-org guard + elimination balance |

Run locally:

```bash
spacetime call lumiere-v1-platform-test run_core_sod_test --no-config
spacetime call lumiere-v1-platform-test run_accounting_fx_revaluation_test --no-config
spacetime call lumiere-v1-platform-test run_all_core_tests --no-config
spacetime call lumiere-v1-platform-test run_all_accounting_tests --no-config
```

## Remaining gaps

- Scheduled/automated retention purge (cron-style) — manual purge only
- Broader field-write coverage beyond `contact` and `opportunity`
- FX revaluation bulk/multi-currency batch UI
