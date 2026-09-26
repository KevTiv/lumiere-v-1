# COV-02B versioned first-org fixture

**Package:** `COV-02B`
**Disposition:** `ACCEPTED` — executed and independently rerun by COV-02C
**Base:** `9b0da75e91e5fe5e3080459f3759da9fb2ae2dc6`
**Manifest:** [`../../frontend/web/fixtures/first-org-fixture.v1.json`](../../frontend/web/fixtures/first-org-fixture.v1.json)
**Provisioner:** [`../../frontend/web/scripts/seed-test-user.mjs`](../../frontend/web/scripts/seed-test-user.mjs)

## Current path trace

```text
component/action:         make e2e-smoke-setup / seed-first-org-personas
hook/application service: seed-test-user.mjs manifest orchestrator
generated operation:      none; trusted local setup uses existing admin reducers
server route:             /v1/auth/internal/bootstrap-credential
STDB owner:               create_role, update_role, add_org_member, assign_role,
                          bind_user_credential, bind_user_profile
affected resources:       role, user_organization, user_role_assignment,
                          user_credential, user_profile
stable fixture identity:  fixture_key + exact organization name/code + company code
result readback:          exact credentials/roles plus 22 scoped module table probes
operator E2E:             seven login/org/company checks plus six managed-role denial checks
```

## Implemented boundary

- the manifest is versioned and checked in;
- organization resolution requires one exact name+code match;
- company resolution requires one exact code and name match;
- no arbitrary organization fallback remains;
- seven personas have stable keys, synthetic emails, role names, and explicit permissions;
- only the organization administrator may use global wildcard authority;
- six managed roles are created or converged through existing role reducers;
- credentials, membership, role assignment, credential binding, and profile binding reuse their canonical owners;
- full E2E setup provisions all seven personas and emits one structured health report covering exact credential, membership, role-assignment, and COV-03..24 module-row checks;
- IoT is required and backed by an owned hub/device, telemetry sample, and stale-device alert.

The legacy `seed-test-user` command still provisions only the administrator for focused local workflows. `seed-first-org-personas` is the shared COV-02 command used by full E2E setup.

## Validation and evidence limit

The offline manifest check validates exact persona and module denominators, unique identities, reserved synthetic domains, non-empty explicit permissions, and the no-wildcard rule for non-admin actors. COV-02C executed the provisioner twice on the dedicated disposable stack, including a PostgreSQL recreation and SpacetimeDB clear/reseed. Both runs reported seven exact persona bindings and all 22 required module rows healthy; the checked-in browser spec passed 13/13 after the independent rerun.

## Next slice

COV-03 owns the next bounded convergence slice: one CRM opportunity operator transition with canonical persisted readback, exact effect identity, representative permission behavior, and browser rerun. The COV-02 fixture does not itself prove module lifecycle or module-specific separation of duties.
