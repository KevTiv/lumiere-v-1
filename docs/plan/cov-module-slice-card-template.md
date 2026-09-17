# COV module slice card template

Copy this for every COV implementation assignment. Delete unused commentary; do not delete required evidence fields.

```md
# COV-XXa — <bounded workflow slice>

Base SHA: <accepted integrated revision>
Promotion target: <U3→U4 | U4→U5 | horizontal equivalent>
Module/surface: <module>
First-org exposure: <exposed | hidden | admin-only | blocked>

## Objective

One sentence describing the operator outcome, not the reducer list.

## Current path

user action:
component/function:
query/application hook:
generated operation:
api-server route:
STDB owner:
canonical affected resources:
stable effect identity:
current result readback/navigation:
current tests:

## Target path

user action
→ generated typed input
→ trusted/current-authorized operation
→ canonical domain transition
→ exact effect readback
→ typed outcome
→ direct resulting-record navigation

## Effect contract

Source key:
Result resource:
Stable relation/idempotency key:
Expected cardinality: <0..1 | 0..N with reason>
Already-applied behavior:
Rejected behavior:
Outcome-unknown reconciliation:
Direct result href/reference:

## Required states

- Applied:
- AlreadyApplied / replay:
- Rejected validation:
- Forbidden:
- Stale/conflict:
- Waiting/approval (if applicable):
- OutcomeUnknown:

## Allowed files

- <paths>

## Reserved / forbidden files

- generated contract output unless release role assigned
- shared route/navigation registration unless coordinator transfers ownership
- unrelated modules

## Hard constraints

- STDB owns business rules/state.
- Current server policy owns authorization.
- Generated operation contracts own mutation structure.
- Browser does not provide authority fields.
- No latest/newest-row or heuristic effect correlation.
- No blind retry after uncertain consequential effect.
- No false success UI from HTTP 2xx alone.
- No direct reducer call in the primary operator E2E transition.

## Deliverables

1. implementation diff
2. typed outcome/effect readback
3. bounded cache invalidation
4. direct result navigation where applicable
5. focused tests
6. operator Playwright proof
7. evidence return using `cov-agent-execution-trail.md`

## Required verification

```bash
# exact commands assigned by coordinator
```

## Acceptance

- [ ] exact effect identity proven zero/one/multiple
- [ ] generated operation used
- [ ] current org/company/permission authority preserved
- [ ] idempotent replay proven
- [ ] no ambiguous retry
- [ ] typed expected failures reach UI boundary
- [ ] direct result ref/readback works after refresh
- [ ] relevant adversarial cases pass
- [ ] incomplete secondary features hidden/classified
- [ ] coordinator reviewed integrated diff
```
