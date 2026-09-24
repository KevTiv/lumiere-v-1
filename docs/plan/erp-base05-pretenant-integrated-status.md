# BASE-05 — integrated pre-tenant certification

Status: **IN PROGRESS — acceptance evidence pending**

Current tip: PR #89 (`codex/base05-pretenant-integrated-certification`), stacked on
BASE-03 PR #88 and BASE-04 PR #87.

## What BASE-05 now executes

PR #89 adds a dedicated pull-request matrix entry for the complete pre-tenant
certification instead of relying on the old September baseline.

The `pretenant` lane uses a clean local SpacetimeDB and blocks browser execution
until these gates pass:

```bash
cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests
make pretenant-cert-native
make check-codegen-pinned
cd frontend/web && pnpm typecheck
```

The normal E2E setup then publishes the same integrated module and executes the
domain-reducer loop, including:

- `run_core_operational_messaging_test` — COMM-* + SM-01;
- `run_accounting_payment_management_test` — PAY-* + SM-02;
- the broader ERP domain reducer inventory used by P0.

Finally, `test:e2e:pretenant` runs only tests tagged `@pretenant`.

## Repairs already made while integrating

- synchronized the latest BASE-03 recipient/COMM-14 fixes from #88;
- fixed the isolated sales ghost-product test fixture to use the fixture's
  persisted currency rather than hard-coded currency id 1;
- added reusable presentation fixtures and executable landed IR-01/02/03 cases;
- activated M-04 saved-draft lost-response certification;
- made committed `approve_ai_action_draft` retry idempotent for the original
  approver and removed the AG-IDEMP-01 expected failure;
- tightened capability probes so absent runtime controls skip with a concrete
  prerequisite while an available capability with no certification fails
  loudly.

## Capability-gated scope still outside this stack

The following remain explicit prerequisite skips rather than BASE-05 passes:

- live AI-gateway agent-loop/policy/budget cases that require a running gateway
  runtime (AG-03..09 as applicable);
- outbound WhatsApp/SMS provider dispatch (`COMM-OUT-01`);
- provider payer identity/manual-review flow (`PAY-PAYER-01`);
- presentation resource/operation toggle controls, active-company switch, and
  harness-generated presentation definitions where the corresponding runtime
  control is absent;
- reconstruction/fault-injection cases owned by REC/GOV work.

These skips must be visible in the final run evidence and are not counted as
certified capabilities.

## Promotion rule

Do not mark BASE-05 `ACCEPTED` until the clean-database pre-tenant run and P0
run have completed and every failure/skip is classified. Record the exact run
id, pass/fail/skip counts, and remaining prerequisite skips here before
promotion.
