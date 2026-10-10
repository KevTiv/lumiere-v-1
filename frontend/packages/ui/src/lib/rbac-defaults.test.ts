import { describe, expect, it } from "vitest"

import { actionsMatch, parsePermissionString } from "./rbac-defaults"

describe("RBAC action vocabulary", () => {
  it("parses the server admin action without replacing it with manage", () => {
    expect(parsePermissionString("tax_deadline:admin")).toEqual({
      resource: "tax_deadline",
      action: "admin",
    })
  })

  it("requires an exact or wildcard rule for admin actions", () => {
    expect(actionsMatch("manage", "admin")).toBe(false)
    expect(actionsMatch("admin", "admin")).toBe(true)
    expect(actionsMatch("*", "admin")).toBe(true)
  })
})
