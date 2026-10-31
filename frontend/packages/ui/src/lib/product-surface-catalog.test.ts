import { existsSync, readdirSync, statSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { buildNavGroups } from "./navigation-catalog"
import {
  FIRST_ORG_QUICK_ACTION_SURFACE_IDS,
  PRODUCT_SURFACES,
  getProductSurface,
  getProductSurfaceForPathname,
  isFirstOrgNavigationAdmitted,
  isFirstOrgRouteAdmitted,
  isFirstOrgSurfaceAdmitted,
} from "./product-surface-catalog"

const moduleRoutesDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../web/app/(modules)",
)

function currentModuleRouteHrefs(): string[] {
  return readdirSync(moduleRoutesDirectory)
    .filter((entry) =>
      statSync(resolve(moduleRoutesDirectory, entry)).isDirectory(),
    )
    .filter((entry) =>
      statSync(resolve(moduleRoutesDirectory, entry, "page.tsx")).isFile(),
    )
    .map((entry) => `/${entry}`)
    .sort()
}

describe("first-org product surface census", () => {
  it("classifies every current module route exactly once", () => {
    const routeSurfaces = PRODUCT_SURFACES.filter(
      (surface) => surface.kind === "route",
    )
    const hrefs = routeSurfaces.map((surface) => surface.href)
    const ids = PRODUCT_SURFACES.map((surface) => surface.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    expect(
      hrefs.filter((href): href is `/${string}` => href !== null).sort(),
    ).toEqual(currentModuleRouteHrefs())
  })

  it("shows Finance and bounded Product/Warehouse/Fleet alpha navigation while Settings stays in REVIEW", () => {
    const memberGroups = buildNavGroups((key) => key, {
      firstOrgProfile: true,
      isAdmin: false,
    })
    expect(memberGroups.map((group) => group.label)).toEqual([
      "nav.groups.finance",
      "nav.groups.operations",
    ])
    expect(memberGroups.flatMap((group) => group.items.map((item) => item.surfaceId))).toEqual([
      "accounting",
      "sales",
      "crm",
      "purchasing",
      "reports",
      "subscriptions",
      "expenses",
      "products",
      "warehouse",
      "fleet",
    ])

    const adminIds = buildNavGroups((key) => key, {
      firstOrgProfile: true,
      isAdmin: true,
    }).flatMap((group) => group.items.map((item) => item.surfaceId))
    expect(adminIds).toEqual([
      "accounting",
      "sales",
      "crm",
      "purchasing",
      "reports",
      "subscriptions",
      "expenses",
      "products",
      "warehouse",
      "fleet",
    ])
  })

  it("keeps supporting ERP routes available without adding them to alpha navigation", () => {
    expect(isFirstOrgSurfaceAdmitted("inventory", true)).toBe(false)
    expect(isFirstOrgRouteAdmitted("inventory", true)).toBe(true)
    expect(isFirstOrgRouteAdmitted("documents", false)).toBe(true)
    expect(isFirstOrgRouteAdmitted("hr", true)).toBe(false)
    expect(isFirstOrgRouteAdmitted("manufacturing", true)).toBe(false)
    expect(isFirstOrgRouteAdmitted("forensics", true)).toBe(false)
    expect(isFirstOrgRouteAdmitted("map", true)).toBe(false)
    expect(isFirstOrgRouteAdmitted("ai-harness", true)).toBe(false)
  })

  it("keeps every navigation destination aligned with the product surface authority", () => {
    const navigationItems = buildNavGroups((key) => key).flatMap(
      (group) => group.items,
    )

    for (const item of navigationItems) {
      const surface = getProductSurface(item.surfaceId)
      expect(surface.kind).toBe("route")
      expect(surface.href).toBe(item.href)
      expect(surface.requiredCapability).toBe(item.resource)
    }
  })

  it("keeps unselected REVIEW and hidden surfaces contained without promoting lifecycle evidence", () => {
    const visibleSurfaceIds = buildNavGroups((key) => key, {
      firstOrgProfile: true,
      isAdmin: true,
    }).flatMap((group) => group.items.map((item) => item.surfaceId))

    for (const surface of PRODUCT_SURFACES) {
      if (
        surface.firstOrgExposure === "review" ||
        surface.firstOrgExposure === "hidden"
      ) {
        expect(isFirstOrgSurfaceAdmitted(surface.id, true)).toBe(false)
        if (surface.boundedAlpha) {
          expect(visibleSurfaceIds).toContain(surface.id)
        } else {
          expect(visibleSurfaceIds).not.toContain(surface.id)
        }
      }
      expect(surface.owner.trim()).not.toBe("")
      expect(surface.minimumEvidence.trim()).not.toBe("")
      if (surface.firstOrgExposure !== "enabled") {
        expect(surface.hiddenReason?.trim()).not.toBe("")
      }
      if (["ai", "internal", "showcase"].includes(surface.classification)) {
        expect(surface.firstOrgExposure).toBe("hidden")
        expect(surface.boundedAlpha).toBeUndefined()
      }
      if (surface.firstOrgExposure === "admin-only") {
        expect(surface.classification).toBe("admin")
        expect(surface.requiredRole).toBe("organization-admin")
      }
      if (["enabled", "admin-only"].includes(surface.firstOrgExposure)) {
        expect(surface.owner).toMatch(/^(COV-|GOV\/CAP|INTRO\/admin)/)
      }
    }
  })

  it("admits only the documented bounded alpha workspaces without awarding U5", () => {
    const alpha = PRODUCT_SURFACES.filter((surface) => surface.boundedAlpha)
    expect(alpha.map((surface) => surface.id)).toEqual(["products", "warehouse", "fleet"])

    for (const surface of alpha) {
      expect(surface).toMatchObject({
        kind: "route",
        classification: "hidden",
        target: "t0-business",
        firstOrgExposure: "review",
      })
      expect(surface.boundedAlpha?.scope).not.toBe("")
      expect(existsSync(resolve(
        moduleRoutesDirectory,
        "../../../..",
        surface.boundedAlpha!.decisionRecord,
      ))).toBe(true)
      for (const isAdmin of [false, true]) {
        expect(isFirstOrgSurfaceAdmitted(surface.id, isAdmin)).toBe(false)
        expect(isFirstOrgNavigationAdmitted(surface.id, isAdmin)).toBe(true)
        expect(isFirstOrgRouteAdmitted(surface.id, isAdmin)).toBe(true)
      }
    }

    expect(getProductSurface("products")).toMatchObject({
      href: "/products",
      owner: "COV-06",
      requiredCapability: "module:inventory",
      canonicalFor: "product-catalog",
    })
    expect(getProductSurface("warehouse")).toMatchObject({
      href: "/warehouse",
      owner: "COV-06",
      requiredCapability: "module:inventory",
      canonicalFor: "warehouse-operations",
    })
    expect(getProductSurface("inventory").boundedAlpha).toBeUndefined()
    expect(getProductSurfaceForPathname("/products/42")?.id).toBe("products")
  })

  it("rejects unknown and unrelated routes for members and administrators", () => {
    for (const isAdmin of [false, true]) {
      for (const surfaceId of ["unknown", "manufacturing", "hr", "map", "forensics", "ai-harness"]) {
        expect(isFirstOrgNavigationAdmitted(surfaceId, isAdmin)).toBe(false)
        expect(isFirstOrgRouteAdmitted(surfaceId, isAdmin)).toBe(false)
      }
    }
    expect(getProductSurfaceForPathname("/products-extra")).toBeNull()
    expect(getProductSurfaceForPathname("/fleets")).toBeNull()
    expect(getProductSurfaceForPathname("/warehouses")).toBeNull()
  })

  it("classifies every sidebar and command-palette quick action", () => {
    for (const surfaceId of FIRST_ORG_QUICK_ACTION_SURFACE_IDS) {
      expect(getProductSurface(surfaceId).kind).toBe("panel")
    }
  })

  it("uses the dedicated Fleet workspace as the sole Fleet owner", () => {
    expect(getProductSurface("fleet")).toMatchObject({
      href: "/fleet",
      canonicalFor: "fleet",
      owner: "COV-15",
    })
    expect(getProductSurface("map")).toMatchObject({
      href: "/map",
      classification: "showcase",
      firstOrgExposure: "hidden",
    })
    expect(getProductSurfaceForPathname("/fleet/42")?.id).toBe("fleet")
  })
})
