# COV-02A seed and persona inventory

**Package:** `COV-02A`
**Disposition:** `REVIEW` — inventory candidate; deterministic fixture implementation remains COV-02B
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

- five current authorities are classified by their actual strength;
- all 22 COV-03..24 owners have explicit seed coverage and remaining gaps;
- 21 modules have partial baseline rows;
- IoT has no owned device/telemetry/alert fixture and is absent;
- only the organization-administrator persona is partial;
- the other six required shared personas are absent, although a suite-local provisioning primitive exists.

The current useful pieces are retained: synthetic ERP baseline records, the documented dev reducer invocation, the browser-admin credential bridge, least-privilege actor creation logic, and the Phase 0 fixture invariants. None is promoted into a second mutation or authorization authority.

## Smallest next implementation slice

`COV-02B` should create one versioned fixture manifest and deterministic orchestration with:

1. an explicit organization key, with no arbitrary first-row fallback;
2. seven named personas and least-privilege grants;
3. canonical signup/membership/role operations for actors;
4. a scoped seed-health readback report for the 22 owners;
5. synthetic stable keys and expected values suitable for independent E2E assertions;
6. clear separation between fixture setup and the operator transition a browser spec claims to prove.

Existing `seed_dev_data` may remain the documented dev baseline while COV-02B composes deterministic identities and health checks around it. Product onboarding paths must still be exercised through their canonical operations when onboarding itself is under test.

## Acceptance boundary

This slice does not execute a disposable full stack, create personas, change seed data, certify module lifecycle coverage, or close COV-02. It only makes the existing authorities and implementation gap machine-checkable.
