# COV first-organization exposure prototype

**Status:** DESIGN PROTOTYPE for COV-00B  
**Current canonical presentation owner:** `frontend/packages/ui/src/lib/navigation-catalog.ts`

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

## 3. Proposed single product-surface authority

Add one checked-in product-surface admission catalog keyed by a stable surface ID, then make navigation and route admission consume it.

Illustrative type:

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
  hidden/internal route cannot become a visible first-org feature by direct URL
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

A route may exist in source while hidden for the first organization. That is containment, not U5 completion; the COV backlog remains.

## 6. Initial decisions that need coordinator/product confirmation

The audit can classify obvious concern families without deciding every product exposure:

- `ai-skills`, `ai-action-drafts`: AI/P0-P1 concern, not T0 dependency;
- `forensics`: INTRO/admin concern, not ordinary T0 module;
- `trackers`: requires explicit product ownership before first-org exposure;
- `settings`: administrative, needs administrator certification rather than business-module U5;
- `/map`: currently owns Fleet/field-asset operations; coordinator must decide whether this is the canonical Fleet product workspace or whether Fleet remains hidden until a dedicated workspace is admitted.

Do not let an implementation worker make those product decisions implicitly by adding/removing a sidebar link.

## 7. Agent rule

Module workers may update a surface's implementation. They may not change `firstOrg` admission unless their assignment explicitly includes the product-exposure decision and coordinator review.

Any new route must declare a product surface classification in the same PR or remain inaccessible from the first-org shell.
