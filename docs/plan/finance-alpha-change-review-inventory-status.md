# Finance alpha change review operation inventory

**Status:** Source inventory implemented; FCR-00 acceptance remains pending owner field, policy and runtime review.
**Date:** 2026-10-26
**Plan:** [Finance alpha change history and review](../plans/finance-alpha-change-review-plan.md).

The generated [operation matrix](../evidence/finance-alpha-change-review-inventory.json)
indexes the seven alpha modules without certifying change history from an audit
call or a frontend route. Normal saves continue to apply normally; selected
financial actions retain their existing owner approval rules. Proposed update
eligibility is a candidate classification until its domain owner validates the
exact editable fields and material revision contract.

## Current denominator

There are 480 unique relevant operations: 427 commands, 46 internal operations
and seven operator paths. All 427 commands are session-exposed in the current
exposure metadata. Exposure is a transport capability, not proof of current
Finance UI reachability or alpha admission. Every listed native source resolves
to its actual function rather than a guessed location from historical contract
evidence. No uncontracted native operation is currently observed.

| Module | Operations including supporting shared paths |
| --- | ---: |
| Accounting | 190 |
| Sales | 72 |
| CRM | 73 |
| Purchasing | 89 |
| Reports | 22 |
| Subscriptions | 41 |
| Expenses | 37 |

Module totals overlap for shared workflow and messaging paths. The inventory
includes module-owned native commands plus explicit Finance import, workflow and
financial-message support. Hidden POS source families are excluded even though
they share the Sales domain. Test-only operations are excluded. Internal and
operator rows remain visible so background/service mutations cannot disappear
behind browser-only accounting.

## Evidence and interpretation

Canonical operation contracts and IDs own identity; reducer exposure owns the
session boundary. Existing COV-00A reachability is retained only as historical
discovery evidence because its fresh frontend coverage input is not checked in.
The inventory does not relabel historical reachable-ui rows as current alpha
acceptance.

The matrix records direct reducer source observations, existing C2 commit
registrations and references to Rust parameter products. The shared product
index stores source paths and field names only; type schemas remain with the
canonical generated-contract owner. Those fields describe inputs, not an
approved proposal field allowlist. Audit old/new-value signals do not establish
completeness, authorization, immutable provenance or restore coverage. Delegated
helpers can perform writes not visible in the direct-body observations.

The first trusted capture call appears in `update_account_move_line`. It is
explicitly marked **partial control flow, owner review required**. This source
signal does not cover its quantity/price PO economic-correction branch,
metadata-only diffs, add/delete operations or other Accounting changes. The
native slice captures ordinary draft-line material fields and retains safe
summary-only audit handling for metadata. Runtime and release evidence belong
to that slice's acceptance, not this static inventory.

## Regeneration and verification

```bash
PYTHONDONTWRITEBYTECODE=1 python scripts/generate-finance-change-review-inventory.py
PYTHONDONTWRITEBYTECODE=1 python scripts/generate-finance-change-review-inventory.py --check
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s scripts/tests -p test_finance_change_review_inventory.py -v
```

The generator imports existing ownership and Rust-boundary parsers rather than
creating a competing operation catalog. Check mode detects stale source-derived
evidence without rewriting it. Input digests bind the canonical identity,
exposure, ownership and persistence metadata used for the result. The output is
deterministic and includes no commit timestamp, environment values or credentials.

Focused checks cover both bare and qualified native reducer attributes,
comment-only false positives, raw-audit non-admission, exact native wrapper
locations, POS exclusion, Finance import/shared-workflow ownership, duplicate
operation identities, parameter references, missing evidence and stale-check
behavior. These are source-boundary and inventory tests; they are not native or
browser certification of a financial workflow.

## Remaining FCR-00 decisions

- Validate the 68 candidate existing-record update operations against exact
  owner field/line contracts, material dependencies and posted-state rules.
- Verify actual current UI/BFF, import, bulk and background-job entry paths;
  static exposure or a legacy census row cannot settle that question.
- Complete current source/company/field authorization and sensitive-history
  policy for every record family, including organization-wide CRM records.
- Approve retention, bounded hot-evidence capacity and durable-store recovery
  behavior through the existing owners.
- Reconcile each operation with runtime exact-effect, denial, stale/retry and
  reconstruction evidence as its implementation lands. No module receives a
  history/review completion claim from this inventory alone.
