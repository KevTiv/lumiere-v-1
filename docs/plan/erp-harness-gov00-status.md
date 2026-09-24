# GOV-00 governed execution status

Status: **REVIEW — implementation complete; live persisted-run acceptance pending**

Implementation revision: `9de0ee4cc`

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

- `cargo test --locked -p ai-gateway --bin gateway`: **584 passed, 6 ignored, 0 failed**.
  The six ignored tests already declare live SpacetimeDB/Qdrant prerequisites.
- `pnpm --dir frontend/web test:unit`: **80 passed, 0 failed**.
- `pnpm --dir frontend/web typecheck`: passed.
- `git diff --check`: passed.

The first sandboxed full gateway run had one loopback-bind `EPERM`; the same
suite passed outside the filesystem/process sandbox, confirming an environment
restriction rather than a product failure.

## Remaining acceptance proof

Do not mark GOV-00 accepted until an integrated stack with a provisioned
`report_analysis` skill, governed runtime bootstrap, spend-read identity and
working configured provider executes the authenticated HTTP route and verifies:

1. the response carries a nonzero durable run id;
2. the scoped `ai_agent_run` exists with the expected organization, company,
   skill and actor-derived execution context;
3. ordered `ai_agent_run_step` rows exist for that run and agree with its
   `step_count`; and
4. a forged JSON authority field and a missing trusted actor header both fail.

No compatible local AI gateway was listening on `127.0.0.1:8080` during this
implementation run, so live HTTP-to-SpacetimeDB persistence was not executed.
