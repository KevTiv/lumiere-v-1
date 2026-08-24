# IoT / Edge / Offline Fleet Foundation Plan

## Purpose

Preserve architectural seams now so a future Fleet + Delivery module can communicate with physical devices and continue useful local operation when WAN/cloud connectivity is unavailable, without turning Fleet into a bespoke transport island.

This is primarily a **future-readiness / contract investigation** for the current branch. It does not require shipping an MQTT broker, edge hardware, CAN/OBD integrations, or Fleet UI now.

## Architectural rule

SpacetimeDB remains the business-transition authority. Physical devices, Expo clients, MQTT brokers, and edge nodes never gain arbitrary reducer/database authority.

```text
Device / sensor / scanner
        ↓
protocol adapter
        ↓
IoT / Edge Gateway
  auth + schema validation
  dedupe + sequencing
  admission/backpressure
        ↓
generated application capability
        ↓
STDB reducer
        ↓
current operational state
        ↓
durable PG history
```

## Why this belongs in the current planning

Fleet/Delivery is a useful future proof case for the existing offline, organization-placement, generated-contract, audit, file-artifact, and admission-control work. The current branch should avoid choices that assume every authoritative user/device action originates from an always-online browser connected directly to the cloud.

## Foundation contracts to investigate

### Device identity and provisioning

Define future-safe concepts for:

- `DeviceId` and organization-owned `DeviceIdentity`;
- device kind/capability descriptors;
- server-established organization ownership (never client/device-asserted tenant identity);
- credential generation/version/rotation/revocation;
- enrollment/commissioning state;
- firmware/protocol version metadata;
- lost/stolen/disabled device state;
- capability-scoped machine authorization compatible with the existing Casbin-style policy boundary.

Device identity must remain distinct from human actor identity while sharing trusted server-derived operation context where appropriate.

### Edge node

Reserve a first-class `EdgeNode` concept for a site/vehicle-local gateway that may later run on an industrial gateway, Android terminal, Raspberry-Pi-class computer, or similar hardware.

An edge node may eventually provide:

- local HTTPS/API;
- local MQTT;
- BLE / Wi-Fi / LAN adapters;
- CAN/OBD/vendor protocol adapters;
- local durable SQLite queue/state;
- device commissioning/discovery;
- WAN synchronization.

An edge node is **not** a second ERP authority. It executes bounded offline capabilities and reconciles through the same generated operation contracts used by other clients.

### Telemetry envelope

Keep telemetry distinct from business commands. A normalized telemetry envelope should be able to preserve at least:

- `organization_id` derived from trusted device registration;
- `device_id`;
- device sequence/idempotency identifier;
- device-reported occurrence time;
- gateway receive time;
- server receive time;
- schema/protocol version;
- typed payload;
- source/edge-node identity.

Do not rely on device clocks alone for ordering. Define replay, duplicate, gap, late-arrival, and malformed-event behavior.

### Device commands and acknowledgements

Commands are controlled intents, not telemetry. Plan typed concepts for:

- command ID/idempotency key;
- target device/edge node;
- desired action/configuration;
- issued/expiry timestamps;
- generation/version;
- acknowledgement/result;
- retry policy;
- authorization/audit correlation.

Business commands originate from authorized STDB-owned workflows and are delivered outward through an outbox/gateway path. Devices must not directly mutate arbitrary business tables.

### Device twin / desired vs reported state

Investigate a small versioned device-twin abstraction for reconnect/offline convergence:

```text
STDB desired state
      ↓
command delivery
      ↓
device / edge node
      ↓
reported state
      ↓
STDB current operational view
```

Keep this separate from raw retained MQTT messages so desired/reported state has explicit versioning and business semantics.

## Offline-first edge behavior

This is the most important future-readiness requirement.

A future delivery workflow should be able to continue during WAN loss:

```text
Internet unavailable

Expo driver app ← local LAN/BLE → EdgeNode ←→ vehicle/scanner/sensors
                                  │
                           durable local queue

Internet restored
                                  ↓
                         bounded reconciliation
                                  ↓
                               STDB
```

The investigation must align with the existing offline reducer/review architecture rather than invent a separate Fleet sync system.

### Local durable queue

Future edge work should reuse the same principles planned for offline clients:

- typed generated operation envelope;
- stable operation/idempotency ID;
- local sequence;
- captured correlation metadata only, never trusted role/org authority;
- dependency/order metadata where necessary;
- retry state;
- reconciliation outcome;
- authoritative server re-authorization on reconnect.

SQLite is the preferred local durable primitive to investigate for both Expo/native offline operation and edge nodes where feasible. The contract should not require the same physical SQLite database or runtime implementation on every surface.

### Offline authorization

Offline capability is not equivalent to permanent authorization.

- cache only a bounded, signed/expiring capability snapshot sufficient for local UX decisions;
- distinguish locally permitted execution from server acceptance;
- re-evaluate Casbin/server policy when reconnecting;
- support `accepted`, `rejected`, `superseded`, `conflict`, and `requires_review` reconciliation outcomes;
- preserve enough evidence for an authoritative user to review offline-originated operations.

Safety-critical or high-risk device commands may be explicitly online-only.

### Local LAN discovery and pairing

Expo should be a participant/commissioning surface, not the universal IoT gateway. Investigate a layered pairing strategy:

1. QR/device-code or NFC-assisted identity pairing;
2. remembered authenticated edge-node identity;
3. mDNS/Bonjour/local discovery as convenience;
4. manual host/device-code fallback.

Do not make multicast discovery a correctness dependency. Expo implementation may require development builds/config plugins/native capabilities; Expo Go compatibility is not a requirement for future IoT functionality.

Local communication must authenticate the edge node/device and use encrypted transport where practical; being on the same LAN is not authentication.

## MQTT and gateway boundary

MQTT is the preferred protocol to investigate for intermittent machine communication, but it remains behind an adapter/gateway boundary.

```text
MQTT / HTTP / BLE / vendor protocol
              ↓
        protocol adapter
              ↓
         IoT Gateway
              ↓
 normalized device contracts
              ↓
 generated ERP capability / STDB
```

The gateway owns protocol normalization, device authentication, schema validation, deduplication, rate limiting, timestamp normalization, command delivery and acknowledgements.

Topic names must never be the sole authorization boundary.

## STDB vs durable history

Do not retain unbounded high-frequency telemetry as hot STDB state.

STDB should own operational projections such as:

- latest known device/vehicle state;
- current vehicle position where useful;
- active route/driver assignment;
- active delivery/stop state;
- current alert state;
- device online/health summary.

Historical telemetry should flow asynchronously to durable storage. Start with Scaleway Managed PostgreSQL; investigate PostGIS for route/geofence/history queries when Fleet work begins. ClickHouse/time-series specialization is deferred until measured volume requires it.

## Fleet / Delivery proof case

Use a future delivery workflow as the acceptance proof for the foundation:

```text
route assigned
  ↓
Expo receives route
  ↓
WAN disappears
  ↓
local EdgeNode + Expo continue
  ├── stop progression
  ├── barcode/scan events
  ├── GPS/geofence evidence
  ├── local device telemetry
  └── proof-of-delivery capture
  ↓
WAN returns
  ↓
reconcile through generated operations
  ↓
STDB accepts/rejects/reviews transitions
  ↓
PG receives durable history
```

Proof-of-delivery photos/signatures/documents should reference `FileAssetRef`/artifact contracts rather than embedding large blobs in reducers. Actual binary upload/synchronization remains aligned with the bucket-ready file-management milestone.

## IR / codegen implications now

Do not encode MQTT, BLE, LAN, or a particular device vendor into application IR. Instead ensure generated operations can represent machine/offline callers through transport-neutral metadata:

- stable operation ID;
- typed input/output;
- idempotency/retry semantics;
- operation risk and confirmation policy;
- traffic/admission class;
- offline eligibility;
- machine/device eligibility where explicitly allowed;
- reconciliation policy hint;
- result/event schema version.

The runtime/gateway chooses MQTT/LAN/HTTP transport. IR describes what the operation means and how safely it may be consumed.

## Admission, security, and resilience integration

Extend future admission-control work to recognize device/telemetry traffic separately from interactive human operations:

- per-org/per-device quotas;
- bounded message size/frequency;
- telemetry batching/coalescing;
- overload shedding of low-priority telemetry before interactive ERP work;
- poison/dead-letter handling;
- command expiry;
- replay protection;
- device credential rotation/revocation;
- observability for queue depth, dropped/coalesced telemetry, sequence gaps and reconnect storms.

A telemetry storm must not starve STDB reducers used by ordinary ERP users.

## Deployment direction

Do not deploy an IoT stack in the current Scaleway bootstrap merely for future readiness. Preserve a logical deployment seam:

```text
Cloudflare / Internet
        ↓
Scaleway Paris application/STDB
        ↕
future IoT Gateway / MQTT
        ↕
future EdgeNodes
```

Edge nodes must remain capable of local operation if Cloudflare/Scaleway is unreachable. Regional STDB placement can later reduce cloud RTT, but local LAN operation must not depend on a regional cell being reachable.

## Explicitly deferred

- production Fleet/Delivery module implementation;
- MQTT broker selection/deployment;
- edge hardware selection;
- CAN/OBD/vendor tracker adapters;
- OTA firmware service;
- high-frequency telemetry warehouse;
- PostGIS implementation;
- production LAN/BLE native modules;
- bucket-backed proof-of-delivery binary sync;
- active-active edge/STDB authority;
- unrestricted device reducer dispatch.

## Exit criteria for this branch

- Future Fleet/IoT callers fit the same generated capability and trusted-operation boundaries.
- Offline operation envelopes can represent device/edge-originated work without trusting tenant/role claims from clients.
- Device telemetry and commands are explicitly separate concepts.
- STDB hot operational state is separated from unbounded telemetry history.
- Edge/LAN operation can continue without WAN while preserving later server reconciliation.
- Fleet proof-of-delivery can reuse file/artifact contracts once the bucket milestone lands.
- No current implementation requires MQTT, edge hardware, large telemetry fixtures, or Expo native IoT work.