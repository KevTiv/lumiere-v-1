# COV-05 through COV-10 and COV-13 through COV-25 runtime acceptance

Date: 2026-10-03

Status: **NOT ACCEPTED**

The same-head runtime run completed. The runtime started, the application built,
the domain aggregate checks passed, and the browser suite ran to completion.
All 43 requested COV browser tests failed. These failures are product acceptance
failures, not an infrastructure abort.

## Immutable identities

- Application head: `0182d34ea66f2ed817c09c7a23ce5c6d77d97082`
- Branch: `codex/cov-d02-d10`
- Pull request: [#147](https://github.com/KevTiv/lumiere-v-1/pull/147)
- Contracts tag: `v0.3.81`
- Contracts commit: `6fc1086a036797067ecb29dd113e13c0a82a9bca`
- SpacetimeDB database: `lumiere-v1-local-e2e`
- PostgreSQL database: `lumiere_cov147_acceptance`

## Release verification

The following commands passed against the pinned `v0.3.81` contract:

```text
make contracts-staging-from-pinned
make check-codegen-pinned
make check-release-compatibility
```

The verified contract contains 1,420 operations, 344 resources, 504 tables,
and 1,361 types. The tenant-ownership check classified all 504 tables as
organization-owned. The release workflow and the artifact-reuse workflow also
passed for this release.

## Runtime proof

The runtime used a clean PostgreSQL database and the Docker/OrbStack services.
The SpacetimeDB module, API server, projection worker, and production web build
started from the application head above.

The following aggregate reducer checks passed on that head:

```text
run_all_core_tests
run_all_inventory_tests
run_all_analytics_tests
```

The Playwright run used one worker and a clean browser fixture setup. Its result
was:

```text
45 tests total
1 authentication setup passed
43 requested COV tests failed
1 additional legacy proposals test failed
0 tests skipped
```

The requested browser test distribution was:

| Scope | Tests executed |
| --- | ---: |
| COV-05 | 3 |
| COV-06 | 12 |
| COV-07 | 4 |
| COV-08 | 6 |
| COV-09 | 1 |
| COV-10 | 1 |
| COV-13 through COV-17 | 5 |
| COV-18 | 2 |
| COV-19 | 2 |
| COV-20 | 1 |
| COV-21 | 1 |
| COV-22 | 2 |
| COV-23 | 1 |
| COV-24 | 1 |
| COV-25 | 1 |
| **Requested total** | **43** |

## Failure classification

| Failure class | Count | Acceptance meaning |
| --- | ---: | --- |
| Required runtime form configuration is absent | 9 | COV-D04 correctly failed closed. The affected operator transitions cannot submit. |
| A denied mutation returned `422` for stale or invalid state instead of `403` | 21 | State validation occurs before authorization. This leaks mutation state and violates the permission-first contract. |
| A denied mutation returned `200` instead of `403` | 10 | The replay, idempotent, or mutation path completes before or without the required authorization check. |
| Separation-of-duties or second-person transition failed | 3 | COV-09 allowed self-approval. The COV-10 and COV-17 second-person transitions did not complete. |
| Additional legacy proposals test used self-approval | 1 | The current separation-of-duties rule rejected the legacy test. This test is outside the requested 43-test COV set. |

The first four rows account for all 43 requested failures.

## Coverage limits

The run does not provide complete browser coverage for these named slices:

- COV-06n has no dedicated browser test.
- COV-07f and COV-07g have no dedicated browser tests.
- COV-25 proves only the first sales-order-to-delivery link.

These slices remain pending even after the shared failures are fixed.

## Required closure order

1. Publish governed runtime form configurations for the nine blocked operator
   transitions. Do not enable an unclassified static fallback.
2. Enforce authorization before stale-state, replay, and mutation validation.
   Denied calls must return `403` and must preserve the effect set.
3. Repair the COV-09 self-approval path and the COV-10 and COV-17
   second-person fixtures or transitions.
4. Add the missing COV-06n, COV-07f, COV-07g, and remaining COV-25 browser
   coverage.
5. Rerun each affected lane on one new exact head. Run the complete 43-test set
   only after the focused lanes pass.

No contract shape changed in the runtime setup patch. A new contract release is
not required for that patch. A contract release will be required if the
permission fix adds authorization metadata to the generated operation contract.
