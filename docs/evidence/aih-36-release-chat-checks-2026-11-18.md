# AIH-36: grounded-chat release checks (2026-11-18)

## Changed
- `scripts/verify-grounded-chat.mjs`: optional fixture-driven scenarios (named record, follow-up in one
  `chat_session_key`, fr/rw questions, empty company, summary handoff, revoked record, import continuation),
  `expectedGap`, `maxWithholdRate`, a cookie pre-flight, a precise 401 message and a job-summary table.
- `release-railway-stack.yml`: the check is on by default when `enable_ai`; `RAILWAY_VERIFY_GROUNDED_CHAT`
  is no longer consulted; new `skip_grounded_chat` input recorded with `github.actor`.
- `release-railway-web.yml`: fixture validation before deploy, live check after the deploy succeeds, same skip input.
- `grounded-chat-nightly.yml`: production check at 03:17 UTC; failures write the run ID only.
- `docs/guides/mistral-alpha-activation.md`: fixture shape and operations.

## Validated
- `node --test scripts/tests/verify-grounded-chat.test.mjs` on Node 22 (mocked fetch only).
- Workflow YAML parses with PyYAML. actionlint was not available.

## Not validated
- No live run against any deployment; no real cookie was used.
- The gateway response has no settled-spend field, so none is asserted.
- Non-interactive acceptance-user sign-in is not implemented (no production tooling exists).
- Scenarios for AIH-30/31/32/34 should be set `expectedGap` until those PRs ship.
