# Niantic Spatial / 3D inventory investigation plan

**Status:** Investigation — mobile-ready follow-up
**Tracks:** `expo`, `inventory`, `spatial`, `3d`, `niantic`, `warehouse`, `digital-twin`
**Related:** [frontend-multisurface-workflow-presentation-plan.md](./frontend-multisurface-workflow-presentation-plan.md) · [iot-edge-offline-fleet-foundation-plan.md](./iot-edge-offline-fleet-foundation-plan.md) · [scaleway-file-management-ingestion-investigation.md](./scaleway-file-management-ingestion-investigation.md)

---

## 1. Objective

Investigate whether Niantic Spatial can provide a useful spatial/AR layer for Lumiere once the Expo/mobile surface is established, especially for warehouse/stock workflows where users may benefit from persistent 3D placement, aisle/bin visualization, item localization, picking guidance, receiving, cycle counts, and spatial inspection.

This is an investigation and scaffolding direction only. Inventory truth remains in SpacetimeDB. Niantic or any future spatial provider may localize/render physical context but must never become the inventory business authority.

Current Niantic Spatial direction to evaluate is NSDK 4.x, including native Swift/Kotlin support and VPS/VPS2 localization, persistent/georeferenced anchors, meshing/depth/occlusion, and scanned/private mapped sites. Avoid new work against legacy Lightship.dev/ARDK 3.x assumptions.

---

## 2. Core architectural rule

```text
STDB inventory authority
  item / lot / bin / warehouse / movement
        ↓
renderer-neutral SpatialInventoryModel
        ↓
mobile spatial adapter
  ├── Niantic Spatial
  ├── ARKit / ARCore fallback
  └── future renderer/provider
        ↓
3D / AR experience
```

The spatial layer visualizes and assists inventory workflows. Stock mutation still uses generated operations + server auth/Casbin + STDB reducers.

---

## 3. Spatial inventory primitives to reserve

Investigate provider-neutral types such as:

```ts
interface SpatialSiteRef {
  id: string
}

interface SpatialAnchorRef {
  id: string
  siteId: string
}

interface SpatialInventoryNode {
  id: string
  resourceRef: ResourceRef
  anchorRef?: SpatialAnchorRef
  localTransform?: Transform3D
  bounds?: Bounds3D
  kind: "warehouse" | "zone" | "aisle" | "rack" | "bin" | "item" | "device"
}
```

Do not persist Niantic-specific IDs directly in business entities. Use a provider-neutral mapping/adapter record so spatial providers can be replaced.

---

## 4. Niantic Spatial investigation

Evaluate NSDK 4.x capabilities against warehouse use cases:

- VPS2 precise localization inside mapped Sites;
- persistent/georeferenced anchors across sessions;
- scanning/mapping private warehouse locations using current Scaniverse workflows;
- mesh availability and runtime mesh download where applicable;
- depth/occlusion/meshing useful for placement and picking overlays;
- native Swift/Kotlin SDK integration paths for an Expo development build/custom native module;
- Unity integration only if a dedicated 3D surface proves preferable to native Expo integration;
- device support/performance on realistic Android devices used in target markets;
- network/bandwidth requirements for localization;
- privacy implications of camera/sensor imagery used for cloud localization;
- pricing, quotas, rate limits, commercial terms, and offline limitations at implementation time.

Do not assume spatial localization works offline. Define an explicit degradation path when VPS/cloud localization is unavailable.

---

## 5. Expo/mobile integration boundary

Investigate a native adapter behind a stable JS/TS interface:

```ts
interface SpatialRuntime {
  localize(site: SpatialSiteRef): Promise<LocalizationResult>
  resolveAnchor(anchor: SpatialAnchorRef): Promise<Pose3D>
  createAnchor(input: CreateSpatialAnchorInput): Promise<SpatialAnchorRef>
  observePose(listener: (pose: DevicePose) => void): Unsubscribe
}
```

Expo app code must depend on this abstraction rather than directly importing Niantic SDK concepts.

Plan for development builds/config plugins/native Swift+Kotlin modules rather than Expo Go.

---

## 6. Inventory UX proof cases

### Proof A — receiving / put-away

```text
receive inventory
  ↓
scan SKU / lot
  ↓
localize warehouse site
  ↓
show target rack/bin in AR
  ↓
user confirms placement
  ↓
normal STDB inventory movement reducer
```

### Proof B — picking

```text
pick list
  ↓
AR highlights aisle/rack/bin
  ↓
barcode/QR confirmation
  ↓
quantity confirmation
  ↓
STDB reducer
```

### Proof C — cycle count

Allow a user to walk a zone, inspect spatial bin overlays, scan/enter actual quantities, work offline where possible, then submit normal review/reconciliation operations.

### Proof D — 3D stock overview

Render warehouse/rack/bin occupancy from renderer-neutral inventory/spatial descriptors without requiring the camera/AR runtime. This should work on web/desktop as a 3D overview and on mobile as either 3D or AR.

---

## 7. Offline behavior

Spatial UX should complement the offline architecture rather than weaken it.

When WAN or Niantic localization is unavailable:

- normal inventory workflows remain usable;
- cached site metadata and logical warehouse maps remain available;
- QR/barcode/bin identifiers provide deterministic fallback navigation;
- manual aisle/rack/bin selection remains possible;
- local SQLite queues preserve inventory intent using existing offline contracts;
- no offline spatial pose is treated as authoritative stock evidence by itself;
- reconciliation on reconnect still crosses the STDB reducer boundary.

Investigate whether device-local ARKit/ARCore anchors or saved coarse transforms can provide a temporary session-local fallback, but do not promise durable cross-session localization without a verified spatial provider path.

---

## 8. 3D asset and file integration

Once Object Storage is ready, evaluate storing:

- warehouse meshes/models;
- rack/bin 3D assets;
- generated previews/thumbnails;
- spatial scan manifests;
- optional spatial annotations.

Large meshes/assets belong in Object Storage, not STDB tables. STDB stores resource refs, mapping state, workflow state, and inventory authority.

Tag implementation work that needs persistent meshes/assets as `BUCKET-READY`.

---

## 9. IR/codegen implications

Current IR should only reserve renderer/provider-neutral structural metadata where useful:

```text
inventory.spatial.site.read
inventory.spatial.mapping.read
inventory.spatial.mapping.propose
inventory.spatial.mapping.apply
inventory.pick.confirm
inventory.putaway.confirm
inventory.count.propose
```

Do not add Niantic/VPS concepts to application-contract IR.

Generated operations may expose spatial-resource refs and presentation intent. Concrete localization/rendering remains a mobile runtime adapter.

---

## 10. Security and authorization

- Casbin remains the authorization authority for mapping/editing/stock capabilities;
- spatial-provider credentials remain server/deployment managed where possible;
- user/device identity sent to spatial providers must follow explicit privacy policy;
- AR observations do not directly mutate stock;
- mapping changes use proposal/review/apply where they affect operational navigation;
- organization/site boundaries must prevent spatial data leakage across tenants.

---

## 11. Evaluation criteria

Before adopting Niantic Spatial, prove:

- localization reliability in an indoor warehouse-like environment;
- acceptable cold-start/localization latency;
- useful accuracy for aisle/rack/bin guidance;
- graceful fallback when localization fails;
- viable Expo/native integration maintenance cost;
- acceptable performance on mid-range Android hardware;
- privacy/commercial terms fit;
- operational value beyond barcode + conventional 2D warehouse UI;
- provider abstraction is strong enough to avoid lock-in.

The feature should only advance if it materially improves receiving, picking, cycle count, stock-location confidence, or training/navigation UX.

---

## 12. Explicitly deferred

- production Niantic integration;
- Unity application surface unless investigation justifies it;
- automatic visual stock recognition/counting;
- autonomous inventory mutation from computer vision;
- warehouse scanning/mesh pipelines before mobile + bucket readiness;
- spatial localization as an authorization signal;
- provider-specific identifiers in core inventory schemas.

---

## 13. Trigger

Begin this investigation when:

1. Expo/mobile surface has a stable generated-contract/offline foundation;
2. inventory receiving/picking/count workflows are usable conventionally;
3. a real warehouse/site can be scanned and tested;
4. Object Storage is available if persistent meshes/assets are required.

The desired outcome is not "AR for AR's sake" but a provider-neutral spatial inventory layer that can make physical stock workflows faster and easier while preserving normal ERP and offline fallbacks.