# COV-02A seed and persona inventory

**Package:** `COV-02A`
**Disposition:** `ACCEPTED` — inventory baseline consumed by COV-02B
**Audited base:** `d5ccc751ab5cadf8ab5463a45d6e2b3617dd53a8`
**Machine evidence:** [`../evidence/cov-02-seed-persona-inventory.json`](../evidence/cov-02-seed-persona-inventory.json)
**Ratchet:** [`../../scripts/validate-cov02-seed-inventory.py`](../../scripts/validate-cov02-seed-inventory.py)

## Current path trace

```text
component/action:        Make e2e-smoke setup orchestration
hook/application service: frontend/web/scripts/e2e-seed-fixture.mjs + seed-test-user.mjs
generated operation:     none for the broad dataset; a dev-only seed reducer is invoked directly
server route:            internal bootstrap-credential route for the single browser admin
STDB owner:              spacetimedb/src/seed.rs::seed_dev_data
affected resources:      broad ERP tables plus one organization/company and owner/admin roles
stable fixture identity: organization display name guard only; no versioned fixture key
result readback:         setup logs; no shared typed seed-health report
operator E2E:            one shared administrator storage state; additional actors are suite-local
```

This path is useful local infrastructure, but it is not the COV-02 acceptance path. The broad dataset is inserted inside a dev-only reducer and must not be treated as proof of product onboarding or operator lifecycle behavior.

## Inventory result

- six current authorities are classified by their actual strength, including the COV-02B manifest;
- all 22 COV-03..24 owners have explicit seed coverage and remaining gaps;
- 21 modules have partial baseline rows;
- IoT has no owned device/telemetry/alert fixture and is absent;
- all seven required personas are now defined in the versioned manifest;
- runtime provisioning, login, permission behavior, and independent-rerun evidence remain COV-02C work.

The current useful pieces are retained: synthetic ERP baseline records, the documented dev reducer invocation, the browser-admin credential bridge, least-privilege actor creation logic, and the Phase 0 fixture invariants. None is promoted into a second mutation or authorization authority.

## COV-02B implementation result

`COV-02B` supplies one versioned fixture manifest and deterministic orchestration with:

1. an explicit organization key, with no arbitrary first-row fallback;
2. seven named personas and least-privilege grants;
3. canonical signup/membership/role operations for actors;
4. a scoped seed-health readback report for the 22 owners;
5. synthetic stable keys and expected values suitable for independent E2E assertions;
6. clear separation between fixture setup and the operator transition a browser spec claims to prove.

Existing `seed_dev_data` remains the documented dev baseline while COV-02B composes deterministic identities and health checks around it. Product onboarding paths must still be exercised through their canonical operations when onboarding itself is under test.

## Acceptance boundary

The inventory and implementation do not certify module lifecycle coverage or close COV-02. COV-02C must execute the fixture on a disposable stack, prove all persona logins and permission boundaries, add the missing IoT baseline, capture health, and prove an independent rerun.
