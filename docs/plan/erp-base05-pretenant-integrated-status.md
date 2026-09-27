# BASE-05 — integrated pre-tenant certification

Status: **ACCEPTED — integrated browser certification closed 2026-09-24**

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
  loudly;
- fixed the Makefile suite dispatch so `E2E_SUITE=pretenant` reaches
  Playwright instead of expanding as an empty Make variable and running the
  full browser inventory;
- repaired landed IR-02 actors and SATS reducer arguments so field, resource,
  and membership revocation are exercised after a successful draft save;
- removed the retired `create_document.index_content` fixture field, kept IoT
  cross-company setup behind the owner-only fixture path, and asserted the
  current toast-based insufficient-stock rejection;
- made the two gateway-dependent AI evidence suites follow the existing
  `E2E_REQUIRE_AI=1` contract: strict AI lanes fail when the gateway is absent,
  while the integrated browser lane records visible prerequisite skips.

## Local integrated evidence — 2026-09-24

The repaired branch was exercised against isolated local SpacetimeDB and
PostgreSQL databases. These are executed browser results, not list-only or
typecheck evidence:

| Lane | Command selector | Result | Classification |
| --- | --- | --- | --- |
| Pre-tenant | `E2E_SUITE=pretenant E2E_WORKERS=1` | 27 passed, 17 skipped, 0 failed (44 discovered; 26 runtime passes plus setup; 2.3m) | All 17 skips carry capability/prerequisite annotations. |
| P0 | `E2E_SUITE=p0 E2E_WORKERS=1` | 89 passed, 9 skipped, 0 failed (98 discovered; 88 runtime passes plus setup; 15.6m) | All 9 skips require the unprovisioned live AI gateway/model stack. |

Focused reruns also passed the repaired IR-02 revocation cases, DOC-009,
IoT company isolation, and the insufficient-stock sales workflow. The live-AI
RAG and human-review suites produced 3 and 2 explicit prerequisite skips,
respectively, when run without the gateway.

The original PR run `36041321175` is retained as failure evidence: it exposed
the selector expansion bug and five P0 fixture/expectation failures. It is not
acceptance evidence.

## Clean CI acceptance evidence — 2026-09-24

GitHub Actions run `36054658413` certified executable commit
`065c45f2f7c93cb5996378a90f723cc3f9b92308` on PR #89:

| Job | Job id | Result |
| --- | --- | --- |
| `Playwright smoke (pretenant)` | `107818604455` | 27 passed, 17 skipped, 0 failed (44 discovered; 26 runtime passes plus setup; 2.8m browser time) |
| `Playwright smoke (p0)` | `107818604390` | 89 passed, 9 skipped, 0 failed (98 discovered; 88 runtime passes plus setup; 19.5m browser time) |
| `E2E gate` | `107832330657` | passed |

The same SHA also passed frontend contracts, i18n, and semantic-index checks.
The pre-tenant job ran the static/native/codegen gates before its clean browser
stack. All skips match the capability-gated and live-AI prerequisites listed
below; none are counted as executed certification.

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

## Promotion decision

The promotion rule is satisfied by clean GitHub Actions run `36054658413` on
executable revision `065c45f2f7c93cb5996378a90f723cc3f9b92308`. Both browser
lanes completed, every skip is classified above, and the exact pass/fail/skip
counts are recorded. Reviewer: Codex coordinator evidence review on PR #89
(not human approval). Contracts remained pinned at immutable release
`v0.3.53`; no contract publication was required.
