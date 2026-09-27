# GOV-00 governed execution status

Status: **ACCEPTED — authenticated browser-to-durable-run certification closed 2026-09-25**

Implementation revision: `9de0ee4cc`
Live acceptance repair revision: `37f04df87`

## Authoritative executor

The original ledger text named `run_recorded_loop`, but that provider-driven
fallback was deliberately removed by `671335498` and its direct-loop adapter by
`2951e3856`. Reintroducing either path would create a second execution authority.
GOV-00 therefore targets the surviving canonical path:

```text
authenticated Next.js BFF
  -> POST /v1/skills/report-analysis
  -> run_governed_llm_skill
  -> run_skill_admitted
  -> GovernedProgramExecutor
  -> append_ai_agent_run_step
```

## Delivered boundary

- The browser supplies only report inputs and company intent. The BFF resolves
  organization, actor identity and actor token from the authenticated session,
  validates company membership, and forwards authority in internal headers.
- The gateway accepts report-analysis tenant and actor authority only from those
  headers. Its closed JSON contract rejects camelCase and snake_case attempts to
  supply organization, company, identity or token authority.
- The gateway route remains behind the required internal shared-secret
  middleware.
- Admitted governed execution now fails closed when the bundled skill has not
  been provisioned as a durable `ai_skill`; a governed run may no longer proceed
  with synthetic run id `0`.
- Every governed graph trace step is appended to `ai_agent_run_step` before the
  run enters a wait or terminal state. Resume starts at the persisted step count,
  and terminal `step_count` reflects the durable total.
- The existing canonical step recorder is shared by classic tools and governed
  graph traces. Its 8,000-byte summary bound is now UTF-8 safe.

No new loop, reducer, generated contract, or contract release was introduced.

## Validation

- `cargo test --locked -p ai-gateway --bin gateway`: **596 passed, 6 ignored, 0 failed**.
  The six ignored tests already declare live SpacetimeDB/Qdrant prerequisites.
- `pnpm --dir frontend/web test:unit`: **80 passed, 0 failed**.
- `pnpm --dir frontend/web typecheck`: passed.
- `git diff --check`: passed.

The first sandboxed full gateway run had one loopback-bind `EPERM`; the same
suite passed outside the filesystem/process sandbox, confirming an environment
restriction rather than a product failure.

## Live acceptance proof — 2026-09-25

The dedicated live stack used isolated database
`lumiere-v1-gov00-cert-20260925`, a provisioned `report_analysis` release,
governed runtime bootstrap, a distinct spend/read identity, and the configured
local Ollama provider. The permanent focused Playwright case
`gov00-governed-execution.spec.ts` passed through real browser authentication
and the Next.js BFF.

- Playwright: **2 passed, 0 failed** (authentication setup plus GOV-00 case).
- The BFF response returned nonzero run id `17`, status `agent_settled`, skill
  `report_analysis`, and ordered steps `1, 2, 3`. The low-confidence settlement
  was the configured policy outcome, not an execution error.
- Durable readback found `ai_agent_run(17)` in organization `264`, company
  `267`, with the signed-in browser actor, `step_count = 3`, and exactly three
  ordered `ai_agent_run_step` rows.
- The same run persisted one succeeded `ai_capability_execution`, four
  `ai_intelligence_event` rows including the typed decision, and one observed
  `ai_decision_case`.
- Missing trusted actor headers returned `403`; forged JSON authority returned
  `422`. Unit coverage also keeps browser authority out of the trusted BFF
  contract and rejects authority in the gateway JSON body.

The live trail repaired only adapter/runtime incompatibilities exposed by this
canonical path: unsupported SpacetimeDB SQL constructs, nested SATS option
encoding, governed-resource binding and input shape, bounded Rust-side
analytics aggregation, Ollama single-tool structured output, confidence
requirements, and durable decision/precedent recording. No alternate executor
or browser-supplied authority was introduced.
