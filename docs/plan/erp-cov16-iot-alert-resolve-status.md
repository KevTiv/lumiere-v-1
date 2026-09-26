# COV-16 — Device alert → acknowledge/resolve

**Status:** SCAFFOLDED — implementation pending  
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

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov16-iot-alert-resolve.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
