import { describe, expect, it } from "vitest"

import { actionsMatch, buildRbacUserFromServer, mapBackendRoleToRole, parsePermissionString } from "./rbac-defaults"
import type { Role } from "./rbac-types"

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

  it.each(["post", "reconcile", "reverse", "cancel"] as const)("keeps the backend %s permission distinct from write", (action) => {
    expect(parsePermissionString(`payment:${action}`)).toEqual({ resource: "payment", action })
    expect(actionsMatch("write", action)).toBe(false)
    expect(actionsMatch(action, action)).toBe(true)
    expect(actionsMatch("*", action)).toBe(true)
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

it("uses authoritative IDs when distinct roles share a name", () => {
  const role = (id: string): Role => ({
    id,
    name: "duplicate",
    description: "",
    color: "blue",
    permissions: [],
    createdAt: "",
    updatedAt: "",
  })
  expect(buildRbacUserFromServer([role("2"), role("3")], [2], "actor")?.roles).toEqual(["2"])
})
