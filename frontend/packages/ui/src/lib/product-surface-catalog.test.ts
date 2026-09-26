import { readdirSync, statSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { buildNavGroups } from "./navigation-catalog"
import {
  FIRST_ORG_QUICK_ACTION_SURFACE_IDS,
  PRODUCT_SURFACES,
  getProductSurface,
  getProductSurfaceForPathname,
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

  it("keeps first-org presentation fail-closed for REVIEW and hidden surfaces", () => {
    const visibleSurfaceIds = buildNavGroups((key) => key, {
      firstOrgProfile: true,
      isAdmin: true,
    }).flatMap((group) => group.items.map((item) => item.surfaceId))

    for (const surface of PRODUCT_SURFACES) {
      if (
        surface.firstOrgExposure === "review" ||
        surface.firstOrgExposure === "hidden"
      ) {
        expect(visibleSurfaceIds).not.toContain(surface.id)
        expect(isFirstOrgSurfaceAdmitted(surface.id, true)).toBe(false)
      }
      expect(surface.owner.trim()).not.toBe("")
      expect(surface.minimumEvidence.trim()).not.toBe("")
      if (surface.firstOrgExposure !== "enabled") {
        expect(surface.hiddenReason?.trim()).not.toBe("")
      }
      if (["ai", "internal", "showcase"].includes(surface.classification)) {
        expect(surface.firstOrgExposure).toBe("hidden")
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
