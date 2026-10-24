# Mistral alpha acceptance — 2026-10-23

Status: implementation and acceptance preparation; live Mistral and Railway acceptance are not executed.

This work starts from PR #136 at `e767bf36d1c6f283ad397dcaf1343d516dbe8f2d`.
This acceptance slice follows the runtime and Railway setup draft PRs (#252 and
#253). The hosted results below predate this patch. Record the final source commit,
contract release, module identity, runtime image digest, organization/company and
profile/policy references before release acceptance. Do not copy tokens, API
keys, private source text or provider reasoning into evidence.

## PR checks observed on 2026-10-23

These results belong to the listed heads, before this worktree's changes.
They do not certify the changed worktree or a deployed environment.

| PR | Head | Hosted result | Limits |
| --- | --- | --- | --- |
| [#135](https://github.com/KevTiv/lumiere-v-1/pull/135) | `71b0981fd259644a6dbb7d6e58d955dad96dae1b` | Returned workflows passed; [E2E run 39935842759](https://github.com/KevTiv/lumiere-v-1/actions/runs/39935842759) passed | Targeted agent-adversarial file only: 3 passed, 2 skipped. No full P0 or live Mistral claim. |
| [#136](https://github.com/KevTiv/lumiere-v-1/pull/136) | `e767bf36d1c6f283ad397dcaf1343d516dbe8f2d` | CI passed; [E2E run 39935891474](https://github.com/KevTiv/lumiere-v-1/actions/runs/39935891474) failed | P0 shard 2/3: 75 passed, 3 skipped, 1 bank-reconciliation failure. |
| [#193](https://github.com/KevTiv/lumiere-v-1/pull/193) | `ae25dbf22b4862811bb07daf94ac4335532baf57` | Returned workflows and [P0 E2E run 39937283528](https://github.com/KevTiv/lumiere-v-1/actions/runs/39937283528) passed | P0 success does not establish live provider or deployed run-history acceptance. |
| [#226](https://github.com/KevTiv/lumiere-v-1/pull/226) | `b97108c4fb72a587e50d8c423a6ae90d26c7032b` | CI passed; [E2E run 39938669079](https://github.com/KevTiv/lumiere-v-1/actions/runs/39938669079) failed | Same bank fixture failure. Authenticated responsive/keyboard/zoom proof remains separate. |

## Bounded acceptance changes

- The positive bank-reconciliation fixture now selects a customer in the current
  company. This reuses the correction in #193: inbound customer settlement must
  not depend on which supplier another spec created first. All invoice/payment,
  stale-replay and denied-replay assertions remain. Failure diagnostics include
  the HTTP status and at most 2,000 response characters.
- GOV00 now fails if `E2E_REQUIRE_AI=1` and `E2E_GOV00_AGENT_ID` is missing or is
  not a positive safe integer. Optional environments retain the explicit skip.
  The prerequisite is checked before application navigation.
- GOV00 retains `@gov00` and adds `@ai-live`. Ordinary optional suites can exclude
  it with their existing `@ai-live` filter. P0 selection does not include this
  test because it has no `@p0` tag. The live pilot must select it explicitly.

No test helper, package script or CI workflow was added. Required live tests
must be provisioned and selected explicitly; an optional or empty test lane is
not acceptance.

## Evidence limits and remaining matrix

| Gate | Existing evidence | Required next evidence | Status here |
| --- | --- | --- | --- |
| Bank fixture and full integration | #193 has passing P0 checks with the customer correction | Run corrected spec in a disposable integrated stack, then current-head P0 gate | Not executed on this worktree |
| Mandatory governed provisioning | GOV00 now rejects missing/invalid agent configuration when AI is required | Discovery/typecheck, then required-AI execution with registered pilot agent | Runtime check not executed |
| Authenticated governed run | GOV00 checks trusted correlation, nonzero run, `agent_settled`, and three persisted steps | Execute the dedicated BFF test against the selected deployed target | Not executed |
| Real Mistral and spend | Transport/ledger fixtures and disposable instrumented-provider recovery exist | Record actual provider/model/profile, run-bound attempts, token usage, reservations and terminal settlement through authorized inspection | Not executed; GOV00 alone does not assert these facts |
| Exact draft and independent approval | AG-03 checks stale/fresh reversal and exactly-once approval; MVP draft test creates a draft through reducers | Complete provider -> governed proposal -> exact draft -> independent approval -> canonical business effect path | Not executed as a complete provider/browser path |
| Denial/revocation/budget | Owner-layer and policy fixtures exist | Show wrong tenant/company denial, next-call revocation and budget exhaustion without provider dispatch | Not executed against Mistral/Railway |
| Cancellation/reconnect/restart | Disposable recovery records one instrumented dispatch across restart and restore | Exercise normal BFF/UI observation and recovery; prove no new attempt or business effect after reconnect | Not executed against Mistral/Railway |
| Reconstruction | [Disposable bundle](./aih-phase4-disposable-2026-10-23.json): 509 restore tables; complete AI row checks; provider count 1 -> 1 | Preserve exact release compatibility; separately verify migration/restore of an existing deployed PG database | Disposable proof exists; deployed migration not executed |
| Run history | #193 has green P0 checks | Integrate #193 through normal review, then inspect the actual deployed pilot run and its economics | Not executed in this #136 worktree |
| Chat workspace | #226 implementation and unit/type checks | Authenticated 320/390/768/1440 widths, keyboard, zoom and long content with actual runs | Not executed |

`agent_settled` does not mean all spend, evidence, drafts and effects are settled.
The MVP draft test uses `create_ai_action_draft` directly; it does not establish
model-produced draft correlation. The remaining AG-09 browser case is an explicit
pending contract. Do not convert it to a pass from the disposable bundle alone.

The #136 run-inspection BFF exists, but this base does not include #193's bounded
run-economics enrichment. This patch therefore adds no guessed provider/attempt/
spend response shape. Add typed assertions when the authorized inspection
contract and integrated runtime support those facts.

## Commands

First install the pinned workspace dependencies through the repository setup.
Use list mode to check selection without starting the application or provider:

```sh
pnpm --dir frontend/web exec playwright test tests/e2e/gov00-governed-execution.spec.ts --project=authenticated --list
pnpm --dir frontend/web exec playwright test tests/e2e/cov08b-bank-statement-reconcile.spec.ts --project=authenticated --list
```

For the bank regression, use the normal seeded disposable E2E stack:

```sh
E2E_WORKERS=1 make e2e-single E2E_SPEC=cov08b-bank-statement-reconcile.spec.ts
```

Do not run the bank fixture against production or real customer data. It creates
and posts synthetic accounting records using the trusted fixture owner.

For a governed pilot, first complete provider, identity, profile/policy, budget,
certified skill and runtime provisioning. Use synthetic ERP data and a dedicated
accepted test account. Set the base URL and agent ID to that explicit target:

```sh
: "${PLAYWRIGHT_BASE_URL:?Set the approved test deployment URL}"
: "${E2E_GOV00_AGENT_ID:?Set the registered pilot agent ID}"
E2E_REQUIRE_AI=1 E2E_WORKERS=1 pnpm --dir frontend/web exec playwright test tests/e2e/gov00-governed-execution.spec.ts --project=authenticated --workers=1 --retries=0
```

The authenticated project's setup must have valid approved test credentials.
This command makes a real governed request and can consume provider budget.
A successful GOV00 result proves only the assertions listed above. Inspect and
record the additional provider/settlement facts before claiming Mistral alpha
acceptance. `/health/ready` is not a Mistral authentication/model-access test.

## Validation of this patch

- Playwright list/discovery passed for both changed specs: one authentication
  setup, one bank case and one GOV00 case (3 tests in 3 files).
- Selection with `--grep-invert @ai-live` includes the bank case and excludes
  GOV00. Explicit selection with `--grep @gov00` includes GOV00.
- Discovery used the existing checkout's installed Playwright/dependency folders
  through ignored symlinks in the isolated worktree. Installed frontend contracts
  differ from this base's release. This proves parsing and test selection only;
  it is not a frozen-install typecheck, browser execution or release acceptance.
- `git diff --check` passed for the assigned changes.

The user authorized draft PR publication after local preparation. No browser,
Mistral request, Railway deployment, migration, merge or production write was
performed for this patch. The required-AI missing-agent failure is
implemented but was not executed through a browser fixture in this session.
