# Local runner acceptance

The first device pilot uses the existing signed-in Codex CLI on macOS and company 4097. The question is read-only and needs one inventory item the pilot user can already read. Record the baseline build, runner and CLI versions, company, fixture or live mode, run and attempt IDs, terminal state, and approved evidence link for each result. Keep provider credentials, account-wide quota values, and record contents out of the proof.

## Coverage

| Scenario | Automated proof | Live acceptance |
| --- | --- | --- |
| Device pairing | Browser authentication, single-use and expired codes, identity and company scoping, and revocation require the gateway route fixture. | Pair the macOS runner as the intended user. Verify the device and its CLI readiness are visible to that user. |
| Duplicate dispatch and reconnect | Host replay sends the same attempt after a connection break, asserts one adapter launch, and verifies replay starts after the acknowledged event. | Reload web chat mid-turn. The original run is still visible and finishes once. |
| Cancellation and failure | Host replay exercises repeated cancellation and a CLI abort. Gateway persistence checks distinguish an acknowledged stop from an unknown outcome. | Cancel an active turn from chat and check that it settles as cancelled. |
| Billing and provider state | Replay checks that unknown economic usage remains unknown. Provider adapters verify normalized usage and auth states against their fixtures. | Confirm the provider account that actually funds the turn, record any reported usage scope, and exercise the signed-out or limited path using an authorized test account. |
| Evidence and permissions | Browser projection must not expose candidate text before admission. Check that attachment, grants, and records remain isolated when company scope changes. | Ask why the test item is low on stock. View the verified inventory link and check its readback under the pilot user. |
| Draft and approval | Fixture verifies proposal, human approval, and one normal ERP effect, including a race with revocation. | Perform only on a test record for which the action has been approved. |
| Managed chat | Run the existing assistant-turn and chat workspace checks with local runners unavailable. | Confirm managed chat remains available when local selection is disabled. |

## Run locally

From the repository root, run `node --test 'local-runner/**/*.test.mjs' scripts/tests/local-runner-replay.test.mjs`. This exercises recorded provider protocols and synthetic sessions through the native host. It uses no account or ERP data.

The web regressions run with `pnpm --dir frontend/web test:unit`. From `frontend/web` with Playwright dependencies installed, use `pnpm exec playwright test --config playwright.ai-chat.config.ts local-runner-browser.spec.ts` for the browser proof. It drives the production local runner client and controls against intercepted gateway responses and checks that page reload reattaches without a second dispatch.

## Release evidence

Before enabling any local provider for a tenant, record the observed pairing, resumed or reattached run, cancellation, final ERP readback, and payer attribution on the exact release build. Record each real CLI and funding mode independently. Replay results and browser test fixtures establish protocol behavior in the test environments. Live status, plan eligibility, and actual charges require evidence from the specific provider mode.
