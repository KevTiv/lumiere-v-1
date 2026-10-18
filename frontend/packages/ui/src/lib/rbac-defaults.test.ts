import { describe, expect, it } from "vitest"

import { actionsMatch, parsePermissionString, mapBackendRoleToRole } from "./rbac-defaults"

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

  it("does not grant create through write", () => {
    expect(actionsMatch('write', 'create')).toBe(false)
    expect(actionsMatch('write', 'update')).toBe(true)
  })
  it('restores display color without restoring permissions from metadata', () => {
    const role = mapBackendRoleToRole({ id: 7, name: 'Reader', isActive: true, permissions: [],
      metadata: JSON.stringify({ color: 'teal', uiPermissions: ['*:*'] }) })
    expect(role?.color).toBe('teal')
    expect(role?.permissions).toEqual([])
  })

})
