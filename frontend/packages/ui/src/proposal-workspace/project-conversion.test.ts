import { describe, expect, it } from "vitest"

import { canConvertProposalToProject, parseProjectConversionInput } from "./project-conversion"

describe("canConvertProposalToProject", () => {
  it("is true only for an Awarded proposal without a project", () => {
    expect(canConvertProposalToProject({ status: { tag: "Awarded" }, projectId: null })).toBe(true)
    expect(canConvertProposalToProject({ status: "awarded" })).toBe(true)
    expect(canConvertProposalToProject({ status: { awarded: [] }, projectId: { none: [] } })).toBe(true)
    expect(canConvertProposalToProject({ status: { awarded: [] }, project_id: undefined })).toBe(true)
  })

  it("is false once converted or for any other status", () => {
    expect(canConvertProposalToProject({ status: "Awarded", projectId: 7 })).toBe(false)
    expect(canConvertProposalToProject({ status: "Awarded", projectId: { some: 7 } })).toBe(false)
    expect(canConvertProposalToProject({ status: "Awarded", project_id: "7" })).toBe(false)
    for (const status of ["Draft", "Review", "Submitted", "Rejected", "Archived", undefined]) {
      expect(canConvertProposalToProject({ status })).toBe(false)
    }
    expect(canConvertProposalToProject(null)).toBe(false)
    expect(canConvertProposalToProject(undefined)).toBe(false)
  })
})

describe("parseProjectConversionInput", () => {
  it("accepts the bill and pricing types the reducer knows", () => {
    expect(parseProjectConversionInput({ billType: "customer_project", pricingType: "fixed_rate" })).toEqual({
      billType: "customer_project",
      pricingType: "fixed_rate",
    })
    expect(parseProjectConversionInput({ billType: "no", pricingType: "employee_rate" })?.billType).toBe("no")
  })

  it("rejects unknown or missing values and a cancelled dialog", () => {
    expect(parseProjectConversionInput({ billType: "monthly", pricingType: "task_rate" })).toBeNull()
    expect(parseProjectConversionInput({ billType: "no", pricingType: "" })).toBeNull()
    expect(parseProjectConversionInput({ pricingType: "task_rate" })).toBeNull()
    expect(parseProjectConversionInput(null)).toBeNull()
  })
})
