import { describe, expect, it } from "vitest"

import { actionsMatch, parsePermissionString } from "./rbac-defaults"

describe("RBAC action vocabulary", () => {
  it("parses the server admin action without replacing it with manage", () => {
    expect(parsePermissionString("tax:deadlines:admin")).toEqual({
      resource: "tax:deadlines",
      action: "admin",
    })
  })

  it("requires an exact or wildcard rule for admin actions", () => {
    expect(actionsMatch("manage", "admin")).toBe(false)
    expect(actionsMatch("admin", "admin")).toBe(true)
    expect(actionsMatch("*", "admin")).toBe(true)
  })

  it("preserves manage coverage for non-admin UI actions", () => {
    expect(actionsMatch("manage", "read")).toBe(true)
    expect(actionsMatch("manage", "update")).toBe(true)
  })
})
