# COV-16 — Device alert → acknowledge/resolve

**Status:** PARTIAL — alert resolution IMPLEMENTED (runtime acceptance pending); action acknowledge still scaffolded  
**Module/surface:** IoT  
**Plan target:** device association, alert and acknowledge  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /iot

Existing operations (already reachable from the frontend command layer):

- `acknowledge_iot_action` — hook: `frontend/packages/query-hooks/src/hooks/iot.ts`
- `resolve_iot_alert` — hook: `frontend/packages/query-hooks/src/hooks/iot.ts`

Canonical resources: iot-alerts, iot-actions

## Effect contract

Same alert id reads back non-null `resolved_at`; action reads back `status`. Stale alert resolution must be rejected.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** `iot-alerts` exposes resolved_at, `iot-actions` exposes status (both organization-scoped; company scope via device)



## Prerequisites / decisions

Owned-device fixture; degraded telemetry must be explicit.

## Slice 1 — alert resolution (implemented)

- **Reducer:** `resolve_iot_alert` (`spacetimedb/src/iot/alerts.rs`) already rejected an
  alert with `resolved_at` set, so no domain change was needed. `IoTAlert` now derives
  `PartialEq` (Rust trait only; no schema or contract change) so the native proof compares
  whole rows.
- **Hook:** `useResolveIotAlert` (`frontend/packages/query-hooks/src/hooks/iot.ts`) reads
  `/api/query/iot-alerts` back after dispatch and resolves the exact row through
  `resolveResolvedIotAlertEffect` (`iot-alert-resolution.ts`): same id, same organization,
  non-null `resolved_at`. Duplicates raise `AmbiguousOperationEffectError`.
- **No contract delta:** `iot-alerts` already projects `resolved_at`, `device_id` and `message`.

## D/A/O/E proof checklist (alert resolution)

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | DONE — `test_resolve_alert_rejects_replay` in `spacetimedb/tests/iot/relational_integrity_test.rs` (cross-org rejected with row unchanged, resolution persists `resolved_at`/`resolved_by`, replay rejected with row unchanged) |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | DONE — `check_permission(iot_alert, write)` + org match; reader replay asserted 403 in the spec |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | DONE — IoT → Alerts → `entity-action-resolve-alert` in `frontend/web/tests/e2e/cov16-iot-alert-resolve.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | DONE — `iot-alert-resolution.test.ts`; spec asserts the snapshot (including the `resolved_at` value) after both replays |

## Slice 2 — action acknowledge (still scaffolded)

`acknowledge_iot_action` needs the same treatment against `iot-actions.status`: confirm the
reducer rejects a non-pending action, then add the readback and proofs.

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
