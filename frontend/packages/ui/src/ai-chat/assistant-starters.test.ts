import { describe, expect, it } from "vitest"
import { assistantStarterIds } from "./assistant-starters"

describe("Assistant starter context", () => {
  it("distinguishes import review from ordinary settings", () => {
    expect(assistantStarterIds({ module: "settings", activeTab: "imports" })).toEqual([
      "importReview", "sourceHistory", "importHelp",
    ])
    expect(assistantStarterIds({ module: "settings", activeTab: "profile" })).toEqual([
      "companySetup", "importHelp", "accessHelp",
    ])
  })

  it("uses the selected workspace route when the host supplies no module", () => {
    expect(assistantStarterIds({ route: "/sales" })).toEqual([
      "quotationHelp", "pricingHelp", "fulfillmentHelp",
    ])
    expect(assistantStarterIds({ module: "documents", route: "/sales" })).toEqual([
      "fileHelp", "templateHelp", "knowledgeHelp",
    ])
  })

  it("offers neutral help for an unknown module or a group context", () => {
    expect(assistantStarterIds({ module: "fleet" })).toEqual([
      "pageHelp", "nextSteps", "draftHelp",
    ])
    expect(assistantStarterIds({ route: "/" })).toEqual(assistantStarterIds())
    expect(assistantStarterIds({ route: "/constructor" })).toEqual(assistantStarterIds())
  })
})
