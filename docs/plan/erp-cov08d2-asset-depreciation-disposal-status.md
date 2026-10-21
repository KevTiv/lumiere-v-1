# COV-08d2 — Fixed-asset depreciation board and disposal exact effects

**Status:** IMPLEMENTED — runtime acceptance pending  
**Branch:** `codex/cov08d2-asset-depreciation-disposal`  
**Module/surface:** Accounting / Assets  
**Plan target:** COV-08 assets  
**Base:** current `main` after #112 landed the COV-08a–d accounting stack

## Bounded path

Operator surface: `/accounting` → Fixed assets.

This slice completes two existing operations through the visible Fixed Assets
surface:

- `compute_depreciation_board` — one Running asset creates one canonical,
  company-scoped depreciation-line set;
- `dispose_account_asset` — the same asset reads back as `Removed`.

The depreciation reducer no longer deletes and recreates unposted rows on a
stale replay. It now requires a Running asset, rejects an already-computed
board, persists the exact board IDs and sequence on the asset, and leaves the
canonical rows unchanged on replay.

## Effect contract

Depreciation resolves only the exact `depreciation-lines` rows whose
`asset_id` is the selected asset, whose company matches the active company and
whose sequence is unique and contiguous. Duplicate row identity or sequence is
an invariant failure.

Disposal resolves only the same company-scoped asset ID in `Removed` state.
The bounded slice does **not** claim disposal-journal-move identity; proving
that downstream journal relation remains a separate contract-expansion task if
it is required by a later Finance certification slice.

## Contract disposition

**Generated contract delta: none expected.** The existing `account-assets`
projection exposes `id`, `company_id` and `state`; the existing
`depreciation-lines` projection exposes `id`, `asset_id`, `company_id`
and `sequence`. No operation signature or resource shape changes in this
slice.

## D/A/O/E proof

| Gate | Proof in this branch | Acceptance condition |
| --- | --- | --- |
| D | `fixed_assets_test.rs::test_depreciation_board_and_disposal_are_single_exact_effect` proves one 12-line board, persisted board identity, replay rejection with an unchanged line/asset snapshot, disposal to Removed, and unchanged disposal replay. It is wired into `run_all_accounting_tests`. | Native Accounting suite passes. |
| A | Existing session operations keep `account_asset:write` permission and organization/company scope. The browser proof replays the captured disposal request as `fixture.reader` and requires 403 with no effect change. | Writer succeeds once; reader is denied before mutation. |
| O | `cov08d2-asset-depreciation-disposal.spec.ts` confirms the fixture asset, then drives **Compute Depreciation** and **Dispose Selected** through the Fixed Assets UI. | Focused Playwright path passes. |
| E | `resolveAccountAssetDepreciationBoardEffect` requires exact asset/company identity plus unique contiguous row identity/sequence; disposal reuses exact same-asset state readback. Unit coverage includes scope/gap/ambiguity cases. Browser proof preserves the exact board and asset snapshot after 422 stale replays and 403 denial. | Unit, native and browser proof are green on one head. |

## Accepted-plan statement

COV-08d2 becomes **ACCEPTED** only when the branch head records all of the
following:

1. contract generation completes with no generated contract delta;
2. query-hooks unit/typecheck and i18n checks pass;
3. `run_all_accounting_tests` passes on a live stack;
4. the focused COV-08d2 Playwright proof passes;
5. branch CI is green on that same head.

Until those artifacts exist, the truthful disposition is **IMPLEMENTED —
runtime acceptance pending**.
