# COV first-organization exposure prototype

**Status:** IMPLEMENTED COV-00B denominator; bounded alpha admission is recorded separately from broader lifecycle acceptance
**Canonical product admission owner:** `frontend/packages/ui/src/lib/product-surface-catalog.ts`
**Canonical presentation owner:** `frontend/packages/ui/src/lib/navigation-catalog.ts`

## 1. Current state

The sidebar and command palette correctly share `buildNavGroups()`, so Lumière already avoids two navigation lists. Each item currently contains:

```ts
{
  label,
  href,
  icon,
  resource, // RBAC presentation check
}
```

This answers **can this actor see/read the resource?** It does not answer **is this product surface admitted for the first test organization?**

The current catalog includes ordinary ERP modules alongside `forensics`, `trackers`, `ai-skills`, and `ai-action-drafts`. RBAC alone therefore cannot be the T0 exposure denominator.

## 2. Keep product exposure separate from authorization

First-org exposure is a product admission decision, not security authority.

```text
server/Casbin authorization
    decides whether an actor may perform/read an operation

product surface admission
    decides whether a route/workspace is part of the first-org product

navigation presentation
    renders the intersection for this user
```

Hiding a route never grants or revokes backend permission.

## 3. Single product-surface authority

The checked-in product-surface admission catalog is keyed by stable surface ID. Navigation and configured first-org route admission consume it. Sidebar and command-palette labels/icons/grouping remain in the navigation catalog; they reference, rather than duplicate, the product-surface decision.

Implemented metadata includes:

```ts
type ProductSurfaceClass =
  | "t0-business"
  | "t0-horizontal"
  | "administrative"
  | "ai"
  | "internal"
  | "retired"

type FirstOrgAdmission =
  | { state: "enabled" }
  | { state: "admin-only"; reason: string }
  | { state: "hidden"; reason: string; owner: string }

interface ProductSurfaceDefinition {
  id: string
  href: `/${string}`
  productClass: ProductSurfaceClass
  firstOrg: FirstOrgAdmission
  covOwner?: string
}
```

The first-org profile is activated only for the organization ID explicitly configured in server-side `LUMIERE_FIRST_TEST_ORGANIZATION_ID`. There is no "first row" or organization-ID heuristic. If the variable is absent, ordinary product navigation is unchanged; an invalid configured value is rejected. When it matches the current session organization, navigation is limited to admitted Finance surfaces and the explicitly selected bounded Products/Warehouse/Fleet alpha workspaces. Settings retains its current review decision. A small, explicit set of supporting ERP routes remains available for cross-module links launched from Finance; every other unadmitted route redirects to the containment page.

Do not create a second independent navigation hierarchy. The existing navigation catalog should reference the stable `surfaceId` and derive admission metadata from this authority.

## 4. Target composition

```text
ProductSurfaceCatalog
  surface identity + product class + first-org admission
           ↓
NavigationCatalog
  labels + icons + grouping + RBAC resource + surfaceId
           ↓
Sidebar / command palette
  first-org admitted ∩ user RBAC

ProductSurfaceCatalog
           ↓
module route/layout admission
  explicit Finance support routes remain linkable; all others stay contained
```

Route admission is product gating, not an authorization substitute. Protected API calls still enforce current server policy.

## 5. COV-00B census ratchets

The acceptance script should compare:

1. route families under `frontend/web/app/(modules)`;
2. navigation catalog entries;
3. product-surface definitions;
4. COV/module ownership.

Required invariants:

```text
every navigation href -> exactly one product surface
every first-org enabled surface -> explicit COV/admin owner
AI/internal surfaces -> cannot be counted as T0 business modules
retired surfaces -> absent from navigation
route without product definition -> fails census or is explicitly framework/internal
no duplicate href or surface id
```

A route on the Finance support allowlist may remain usable through a Finance workflow while hidden from first-organization navigation. That availability is not U5 completion; the COV backlog remains.

## 6. Current decisions and explicit review entries

The audit can classify obvious concern families without deciding every product exposure:

- `ai-skills`, `ai-action-drafts`: AI/P0-P1 concern, not T0 dependency;
- `forensics`: INTRO/admin concern, not ordinary T0 module;
- `trackers`: requires explicit product ownership before first-org exposure;
- `settings`: administrative, needs administrator certification rather than business-module U5;
- `/fleet` is the canonical COV-15 Fleet workspace. It now owns the broader vehicle, driver, service and inspection lifecycle.
- `/map` is a mixed geospatial showcase (Fleet position, warehouse and POS pins), is hidden from the first-org profile, and must receive a separate product owner before admission. It is not a second Fleet workspace authority.

Finance routes are admitted to alpha navigation. Products, Warehouse and Fleet also have the explicit [2026-10-31 bounded alpha decision](../plans/product-fleet-alpha-2026-10-31.md), stored as `boundedAlpha` metadata in the same catalog. Their `firstOrgExposure` and broader lifecycle evidence remain `review`; `isFirstOrgSurfaceAdmitted` still returns false for them, while the navigation/route helper applies the bounded decision. This admits only the documented catalog, operational Warehouse and vehicle-history workspaces; it does not certify the broader Inventory/WMS or full Fleet lifecycle.

Tasks, Inventory, Workflows, Approvals, Documents, Calendar, and Messages may support Finance deep links without appearing in first-org navigation. Every other `REVIEW`, AI, internal, and showcase route remains fail closed. `trackers` and `notebook` retain explicit `BLOCKED: product owner required` ownership rather than an invented policy. Unknown IDs and route prefixes are not admitted.

Do not let an implementation worker make those product decisions implicitly by adding/removing a sidebar link.

## 7. Agent rule

Module workers may update a surface's implementation. They may not change `firstOrg` admission unless their assignment explicitly includes the product-exposure decision and coordinator review.

Any new route must declare a product surface classification in the same PR or remain inaccessible from the first-org shell.
