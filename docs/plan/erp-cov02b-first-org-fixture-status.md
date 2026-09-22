# COV-02B versioned first-org fixture

**Package:** `COV-02B`
**Disposition:** `REVIEW` — implementation candidate; disposable-stack execution remains COV-02C
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
operator E2E:             deferred to COV-02C; setup is not operator proof
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
- IoT is recorded as an optional missing row rather than silently treated as seeded.

The legacy `seed-test-user` command still provisions only the administrator for focused local workflows. `seed-first-org-personas` is the shared COV-02 command used by full E2E setup.

## Validation and evidence limit

The offline manifest check validates exact persona and module denominators, unique identities, reserved synthetic domains, non-empty explicit permissions, and the no-wildcard rule for non-admin actors. The full-stack provisioner was not executed in this slice, so credential/membership/permission behavior and module table health remain unproven runtime evidence.

## Next slice

COV-02C must run a disposable full stack, capture the structured health result, prove each persona can sign in, assert representative allow/deny and separation-of-duties cases, add the missing IoT fixture, clear/reseed, and prove an independent rerun.
