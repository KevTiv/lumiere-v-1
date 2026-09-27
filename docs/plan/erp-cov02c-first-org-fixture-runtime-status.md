# COV-02C first-org fixture runtime acceptance

**Package:** `COV-02C`
**Disposition:** `ACCEPTED` — shared runtime fixture foundation only
**Base:** `7b0e141831ec98d461c7fe6a6a0b774c10c5db1f`
**Machine evidence:** [`../evidence/cov-02-seed-persona-inventory.json`](../evidence/cov-02-seed-persona-inventory.json)
**Browser proof:** [`../../frontend/web/tests/e2e/first-org-personas.spec.ts`](../../frontend/web/tests/e2e/first-org-personas.spec.ts)

## Accepted runtime path

```text
setup action:            make e2e-smoke-setup
manifest/provisioner:    first-org-fixture.v1.json + seed-test-user.mjs
credential boundary:     /v1/auth/internal/bootstrap-credential
canonical STDB owners:   create_role, update_role, add_org_member, assign_role,
                         bind_user_credential, bind_user_profile
health readback:         exact credential, membership, role assignment, company,
                         and COV-03..24 tenant-scoped table probes
operator proof:          seven browser sign-ins and six denied create_role calls
rerun boundary:          dedicated PostgreSQL recreation plus dedicated STDB clear/reseed
```

The accepted stack used only `lumiere_cov02c_e2e` and `lumiere-cov02c-e2e`; no shared local database was cleared.

## Result

- all seven manifest personas were provisioned with exactly one credential, one active organization membership, and one active role assignment;
- each persona signed in through the application and resolved a positive session organization plus a visible company;
- all six managed-role personas were denied organization-role administration by the canonical reducer boundary;
- all 22 COV-03..24 health probes were required and present;
- COV-16 now includes an owned offline hub, temperature device, telemetry sample, and unresolved stale-device alert, and POS references that device by canonical ID;
- the clean independent rerun repeated the healthy 7-persona/22-owner report and passed the same 13 browser checks.

## Executed validation

- `cargo check --locked` in `spacetimedb`: passed with 10 existing warnings;
- `PG_DATABASE=lumiere_cov02c_e2e make e2e-smoke-setup E2E_STDB_MODULE=lumiere-cov02c-e2e E2E_CLEAR_DB=1`: passed core tests, all listed domain reducers, fixture provisioning, and healthy readback;
- `PG_DATABASE=lumiere_cov02c_e2e make e2e-single-test E2E_SPEC=first-org-personas.spec.ts E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov02c-e2e`: 13 passed after the independent rerun.

## Evidence limit

COV-02C proves fixture availability, authentication, tenant/company resolution, and one representative authorization denial. It does not promote any module to U4/U5 and does not substitute for module-specific allow/deny, separation-of-duties, exact effect, replay, lost-response, or recovery evidence.

## Next slice

Start COV-03 with one CRM opportunity operator transition. Reuse the accepted `sales-crm` persona, drive the transition through the UI, read the canonical persisted opportunity/conversion effect, prove exact one-to-one identity, and include representative denial plus rerun behavior.
