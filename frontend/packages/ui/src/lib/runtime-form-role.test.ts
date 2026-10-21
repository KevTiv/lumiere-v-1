import { describe, expect, it } from "vitest"

import { EFFECTIVE_ACCESS_ROLE_ID, resolveRuntimeFormRoleId } from "./runtime-form-role"

describe("resolveRuntimeFormRoleId", () => {
  it("selects the persisted form role rather than the synthetic grant role", () => {
    expect(resolveRuntimeFormRoleId([EFFECTIVE_ACCESS_ROLE_ID, "420"])).toBe("420")
    expect(resolveRuntimeFormRoleId([EFFECTIVE_ACCESS_ROLE_ID, "role-admin"])).toBe("role-admin")
  })

  it("retains deterministic first-role selection for multiple persisted roles", () => {
    expect(resolveRuntimeFormRoleId([EFFECTIVE_ACCESS_ROLE_ID, "420", "421"])).toBe("420")
  })

  it("fails closed when no persisted role is available", () => {
    expect(resolveRuntimeFormRoleId([EFFECTIVE_ACCESS_ROLE_ID])).toBeUndefined()
    expect(resolveRuntimeFormRoleId(undefined)).toBeUndefined()
    expect(resolveRuntimeFormRoleId([])).toBeUndefined()
  })
})
