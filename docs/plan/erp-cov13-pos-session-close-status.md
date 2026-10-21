# COV-13 — Session order/payment → close

**Status:** IMPLEMENTED — runtime acceptance pending  
**Branch:** `codex/cov13-pos-session-close`  
**Stack base:** `codex/cov12-subscription-invoice-run`  
**Module/surface:** POS  
**Plan target:** one paid POS session closed through the operator surface

## Bounded path

Operator surface: `/pos` → Admin.

The browser proof:

1. opens a fresh session for seeded `Front Desk Demo POS` through the visible
   **Open POS Session** form;
2. creates one paid POS order as trusted fixture setup against that exact
   session;
3. verifies the session carries the order;
4. drives **Close POS Session** through the visible admin form;
5. resolves the same session as Closed through its exact config/company scope;
6. replays the accepted close request to prove stale rejection and unchanged
   state;
7. replays as `fixture.reader@example.test` and requires HTTP 403 with the
   exact effect unchanged.

The order/payment setup uses the existing `create_pos_order` domain operation;
the COV-13 action under certification remains `close_pos_session`.

## Corrected scope finding

The scaffold said the `pos_session` table had no organization/company scope
available. Source inspection showed:

- `PosSession` already has `organization_id` and `config_id`;
- `PosConfig` already has `organization_id` and `company_id`.

No new domain column or join table is required.

COV-13 exposes the existing `organization_id` fields on the
`pos-sessions` and `pos-configs` read projections. Company scope is then
resolved canonically as:

`pos_session.config_id → pos_config.id → pos_config.company_id`.

This projection change intentionally triggers the automatic contracts release.

## Exact effect contract

`resolveClosedPosSessionEffect` requires:

- exactly one session with the requested primary key;
- session `organization_id` = current organization;
- session state = `Closed`;
- session `config_id` resolves to exactly one config;
- config `organization_id` = current organization;
- config `company_id` = selected operating company;
- persisted `cash_register_balance_end_real` equals the requested closing
  balance.

Duplicate exact session/config identities fail closed. No newest-session,
terminal-name or timestamp correlation is used.

The React Query close hook uses
`executeOperationWithCanonicalReadback`, so a lost response can reconcile to
the already-closed exact session without a second dispatch.

## Domain replay semantics

`close_pos_session` is a one-way state transition:

- Opened / ClosingControl → Closed succeeds once;
- replay after Closed is rejected by the domain state guard;
- cross-organization close is rejected before mutation;
- rejected replay leaves session stop time, closing balance, session write
  timestamp, config closing cash/date and config write timestamp unchanged.

The native proof is wired directly into `run_all_sales_tests`; no new public
test reducer was added.

## Contract disposition

**Contract release required and triggered.**

Changed projection only:

- `pos-sessions.organization_id` exposed;
- `pos-configs.organization_id` exposed.

The existing `config_id`, `company_id`, session state/order count and
closing-balance fields remain the canonical data model.

## D/A/O/E proof

| Gate | Proof in this branch | Acceptance condition |
| --- | --- | --- |
| D | `pos_session_close_test.rs` creates a real config/session, proves cross-org denial, closes once, then proves stale replay leaves session and config close fields unchanged. Wired into `run_all_sales_tests`. | `run_all_sales_tests` passes. |
| A | Existing reducer checks session organization, config organization, `pos_session:close` permission and opener identity. Browser reader replay must return 403. | Authorized opener succeeds; wrong org/reader cannot change the effect. |
| O | `cov13-pos-session-close.spec.ts` visibly opens a session, attaches a paid order fixture, then closes it through `/pos` Admin. | Focused Playwright proof passes. |
| E | `pos-session-close-effect.test.ts` covers identity, org/config/company scope, state, balance and ambiguity; browser snapshot is preserved after stale 422 and reader 403. | Query-hook unit/native/browser evidence green on one head. |

## Acceptance

COV-13 becomes **ACCEPTED** only when the same branch head records:

1. automatic contracts release/pin for the POS scope projection;
2. query-hooks typecheck + unit tests;
3. `run_all_sales_tests` on a live stack;
4. focused COV-13 Playwright proof;
5. branch CI green.

Stock/accounting convergence remains covered by the prerequisite COV-06/COV-08
acceptance lanes; this bounded slice does not duplicate those domains.

Until the gates above pass, the truthful disposition is **IMPLEMENTED —
runtime acceptance pending**.
