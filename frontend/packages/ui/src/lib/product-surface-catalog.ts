import type { Resource } from "./rbac-types"

export type ProductSurfaceClassification =
  | "admitted-t0"
  | "admin"
  | "ai"
  | "internal"
  | "showcase"
  | "hidden"

export type ProductSurfaceTarget =
  | "t0-business"
  | "t0-horizontal"
  | "administrative"
  | "ai"
  | "internal"
  | "showcase"

export type FirstOrgExposure = "enabled" | "admin-only" | "hidden" | "review"

export interface ProductSurfaceDefinition {
  id: string
  kind: "route" | "panel"
  href: `/${string}` | null
  classification: ProductSurfaceClassification
  target: ProductSurfaceTarget
  firstOrgExposure: FirstOrgExposure
  owner: string
  requiredRole: "organization-admin" | null
  requiredCapability: Resource | null
  minimumEvidence: string
  hiddenReason: string | null
  canonicalFor?: string
}

const pendingU5 = (
  id: string,
  href: `/${string}`,
  target: "t0-business" | "t0-horizontal",
  owner: string,
  requiredCapability: Resource,
  canonicalFor?: string,
): ProductSurfaceDefinition => ({
  id,
  kind: "route",
  href,
  classification: "hidden",
  target,
  firstOrgExposure: "review",
  owner,
  requiredRole: null,
  requiredCapability,
  minimumEvidence: `${owner} U5 acceptance revision`,
  hiddenReason: `${owner} has not supplied accepted U5 first-organization evidence`,
  canonicalFor,
})

/**
 * Canonical first-test-organization product-surface denominator.
 *
 * This is product admission metadata, not authorization. Server/Casbin policy
 * remains authoritative for reads and writes after a surface is admitted.
 * REVIEW entries are fail-closed for the configured first test organization.
 */
export const PRODUCT_SURFACES: readonly ProductSurfaceDefinition[] = [
  pendingU5(
    "overview",
    "/overview",
    "t0-horizontal",
    "COV-25/26",
    "dashboard:overview",
  ),
  pendingU5("tasks", "/tasks", "t0-horizontal", "COV-10", "dashboard:tasks"),
  pendingU5(
    "accounting",
    "/accounting",
    "t0-business",
    "COV-08",
    "module:accounting",
  ),
  pendingU5("sales", "/sales", "t0-business", "COV-04", "module:sales"),
  pendingU5("crm", "/crm", "t0-business", "COV-03", "module:crm"),
  pendingU5(
    "purchasing",
    "/purchasing",
    "t0-business",
    "COV-05",
    "module:purchasing",
  ),
  pendingU5("reports", "/reports", "t0-horizontal", "COV-20", "module:reports"),
  pendingU5(
    "subscriptions",
    "/subscriptions",
    "t0-business",
    "COV-12",
    "module:subscriptions",
  ),
  pendingU5(
    "expenses",
    "/expenses",
    "t0-business",
    "COV-11",
    "module:expenses",
  ),
  pendingU5(
    "inventory",
    "/inventory",
    "t0-business",
    "COV-06",
    "module:inventory",
  ),
  pendingU5(
    "distributor",
    "/distributor",
    "t0-business",
    "COV-24",
    "module:inventory",
  ),
  pendingU5("pos", "/pos", "t0-business", "COV-13", "module:pos"),
  pendingU5(
    "manufacturing",
    "/manufacturing",
    "t0-business",
    "COV-07",
    "module:manufacturing",
  ),
  pendingU5(
    "fleet",
    "/fleet",
    "t0-business",
    "COV-15",
    "module:fleet",
    "fleet",
  ),
  pendingU5(
    "helpdesk",
    "/helpdesk",
    "t0-business",
    "COV-14",
    "module:helpdesk",
  ),
  pendingU5(
    "workflows",
    "/workflows",
    "t0-horizontal",
    "COV-21",
    "module:workflows",
  ),
  pendingU5(
    "approvals",
    "/approvals",
    "t0-horizontal",
    "COV-21",
    "module:workflows",
  ),
  pendingU5(
    "documents",
    "/documents",
    "t0-horizontal",
    "COV-18",
    "module:documents",
  ),
  pendingU5(
    "proposals",
    "/proposals",
    "t0-business",
    "COV-17",
    "module:proposals",
  ),
  pendingU5(
    "calendar",
    "/calendar",
    "t0-horizontal",
    "COV-19",
    "module:calendar",
  ),
  pendingU5(
    "messages",
    "/messages",
    "t0-horizontal",
    "COV-19",
    "module:messages",
  ),
  pendingU5("hr", "/hr", "t0-business", "COV-09", "module:hr"),
  pendingU5(
    "projects",
    "/projects",
    "t0-business",
    "COV-10",
    "module:projects",
  ),
  pendingU5("iot", "/iot", "t0-business", "COV-16", "module:iot"),
  {
    id: "settings",
    kind: "route",
    href: "/settings",
    classification: "admin",
    target: "administrative",
    firstOrgExposure: "review",
    owner: "COV-23",
    requiredRole: "organization-admin",
    requiredCapability: "dashboard:settings",
    minimumEvidence: "COV-23 U5-equivalent administrator acceptance revision",
    hiddenReason:
      "administrator surface remains REVIEW pending COV-23 acceptance",
  },
  {
    id: "ai-action-drafts",
    kind: "route",
    href: "/ai-action-drafts",
    classification: "ai",
    target: "ai",
    firstOrgExposure: "hidden",
    owner: "GOV/CAP",
    requiredRole: null,
    requiredCapability: "dashboard:analytics",
    minimumEvidence: "P0/P1 governed AI surface admission",
    hiddenReason: "AI governance is independent of the T0 ERP denominator",
  },
  {
    id: "ai-harness",
    kind: "route",
    href: "/ai-harness",
    classification: "ai",
    target: "ai",
    firstOrgExposure: "hidden",
    owner: "GOV/CAP",
    requiredRole: null,
    requiredCapability: "dashboard:analytics",
    minimumEvidence: "P0/P1 governed AI surface admission",
    hiddenReason: "harness inspection is not an ordinary first-org ERP surface",
  },
  {
    id: "ai-skills",
    kind: "route",
    href: "/ai-skills",
    classification: "ai",
    target: "ai",
    firstOrgExposure: "hidden",
    owner: "GOV/CAP",
    requiredRole: null,
    requiredCapability: "dashboard:analytics",
    minimumEvidence: "P0/P1 governed AI surface admission",
    hiddenReason: "AI governance is independent of the T0 ERP denominator",
  },
  {
    id: "forensics",
    kind: "route",
    href: "/forensics",
    classification: "internal",
    target: "internal",
    firstOrgExposure: "hidden",
    owner: "INTRO/admin",
    requiredRole: "organization-admin",
    requiredCapability: "dashboard:analytics",
    minimumEvidence: "explicit INTRO/admin product admission",
    hiddenReason: "internal forensics is not an ordinary T0 business module",
  },
  {
    id: "presentation-preview",
    kind: "route",
    href: "/presentation-preview",
    classification: "internal",
    target: "internal",
    firstOrgExposure: "hidden",
    owner: "frontend-IR/UX",
    requiredRole: "organization-admin",
    requiredCapability: "dashboard:settings",
    minimumEvidence: "explicit frontend-IR administrator admission",
    hiddenReason: "presentation preview is an internal authoring surface",
  },
  {
    id: "trackers",
    kind: "route",
    href: "/trackers",
    classification: "showcase",
    target: "showcase",
    firstOrgExposure: "hidden",
    owner: "BLOCKED: product owner required",
    requiredRole: null,
    requiredCapability: "dashboard:analytics",
    minimumEvidence:
      "product owner, COV assignment, and U5-equivalent acceptance",
    hiddenReason:
      "showcase route has no accepted product owner or first-org use case",
  },
  {
    id: "map",
    kind: "route",
    href: "/map",
    classification: "showcase",
    target: "showcase",
    firstOrgExposure: "hidden",
    owner: "COV-15 geospatial showcase",
    requiredRole: null,
    requiredCapability: "module:map",
    minimumEvidence:
      "separate geospatial product owner and U5-equivalent acceptance",
    hiddenReason:
      "/fleet is the canonical Fleet workspace; /map remains a mixed geospatial showcase",
  },
  {
    id: "journal",
    kind: "panel",
    href: null,
    classification: "internal",
    target: "internal",
    firstOrgExposure: "hidden",
    owner: "frontend-IR/UX",
    requiredRole: null,
    requiredCapability: null,
    minimumEvidence: "explicit product owner and operator acceptance",
    hiddenReason:
      "journal panel has no accepted first-org product classification",
  },
  {
    id: "notebook",
    kind: "panel",
    href: null,
    classification: "showcase",
    target: "showcase",
    firstOrgExposure: "hidden",
    owner: "BLOCKED: product owner required",
    requiredRole: null,
    requiredCapability: "tools:notebook",
    minimumEvidence: "product owner and operator acceptance",
    hiddenReason: "notebook is not part of the accepted T0 product denominator",
  },
  {
    id: "ai-assistant",
    kind: "panel",
    href: null,
    classification: "ai",
    target: "ai",
    firstOrgExposure: "hidden",
    owner: "GOV/CAP",
    requiredRole: null,
    requiredCapability: "tools:ai-chat",
    minimumEvidence: "P0/P1 governed AI surface admission",
    hiddenReason: "AI governance is independent of the T0 ERP denominator",
  },
] as const

const surfacesById = new Map(
  PRODUCT_SURFACES.map((surface) => [surface.id, surface]),
)
const routeSurfaces = PRODUCT_SURFACES.filter(
  (surface): surface is ProductSurfaceDefinition & { href: `/${string}` } =>
    surface.kind === "route" && surface.href !== null,
)

export function getProductSurface(surfaceId: string): ProductSurfaceDefinition {
  const surface = surfacesById.get(surfaceId)
  if (!surface) throw new Error(`Unknown product surface: ${surfaceId}`)
  return surface
}

export function getProductSurfaceForPathname(
  pathname: string,
): ProductSurfaceDefinition | null {
  return (
    routeSurfaces.find(
      (surface) =>
        pathname === surface.href || pathname.startsWith(`${surface.href}/`),
    ) ?? null
  )
}

export function isFirstOrgSurfaceAdmitted(
  surfaceId: string,
  isAdmin: boolean,
): boolean {
  const surface = getProductSurface(surfaceId)
  if (surface.firstOrgExposure === "enabled") return true
  return surface.firstOrgExposure === "admin-only" && isAdmin
}

export const FIRST_ORG_QUICK_ACTION_SURFACE_IDS = [
  "journal",
  "notebook",
  "ai-assistant",
] as const
