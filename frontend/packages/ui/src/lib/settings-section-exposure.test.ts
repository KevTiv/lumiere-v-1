import { describe, expect, it } from "vitest"

import {
  SETTINGS_SECTION_EXPOSURE,
  isSettingsSectionAdmitted,
  isSettingsSectionVisibleForProfile,
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

  it("admits only AI configuration for finance alpha administrators", () => {
    expect(isSettingsSectionVisibleForProfile("ai", true, true)).toBe(true)
    expect(isSettingsSectionVisibleForProfile("ai", false, true)).toBe(false)
    expect(isSettingsSectionAdmitted("users", false)).toBe(false)
    expect(isSettingsSectionVisibleForProfile("users", true, true)).toBe(false)
    expect(isSettingsSectionVisibleForProfile("profile", false, true)).toBe(false)
    expect(isSettingsSectionAdmitted("unclassified-future-setting", true)).toBe(false)
  })

  it("leaves settings unchanged outside the configured alpha organization", () => {
    expect(isSettingsSectionVisibleForProfile("profile", false, false)).toBe(true)
    expect(isSettingsSectionVisibleForProfile("users", true, false)).toBe(true)
    expect(isSettingsSectionVisibleForProfile("ai", true, false)).toBe(false)
    expect(isSettingsSectionVisibleForProfile("profile", true, true)).toBe(false)
  })
})
