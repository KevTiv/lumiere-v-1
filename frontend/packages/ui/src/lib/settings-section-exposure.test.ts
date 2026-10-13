import { describe, expect, it } from "vitest"

import {
  SETTINGS_SECTION_EXPOSURE,
  isSettingsSectionAdmitted,
  settingsSections,
} from "./rbac-defaults"

describe("first-organization Settings exposure", () => {
  it("classifies every Settings section exactly once", () => {
    const sectionIds = settingsSections.map((section) => section.id).sort()
    const policyIds = SETTINGS_SECTION_EXPOSURE.map((policy) => policy.id).sort()
    expect(policyIds).toEqual(sectionIds)
    expect(new Set(policyIds).size).toBe(policyIds.length)
    for (const policy of SETTINGS_SECTION_EXPOSURE) {
      expect(policy.owner.trim()).not.toBe("")
      expect(policy.minimumEvidence.trim()).not.toBe("")
      if (policy.exposure !== "enabled") expect(policy.hiddenReason?.trim()).not.toBe("")
    }
  })

  it("keeps internal AI settings hidden and admin settings role-gated", () => {
    expect(isSettingsSectionAdmitted("ai", true)).toBe(false)
    expect(isSettingsSectionAdmitted("users", false)).toBe(false)
    expect(isSettingsSectionAdmitted("users", true)).toBe(true)
    expect(isSettingsSectionAdmitted("profile", false)).toBe(true)
    expect(isSettingsSectionAdmitted("unclassified-future-setting", true)).toBe(false)
  })
})
