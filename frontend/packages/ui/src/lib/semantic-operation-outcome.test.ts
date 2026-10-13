import { describe, expect, it, vi } from "vitest"

import type { SemanticOperationOutcomeDetail } from "@lumiere/query-hooks/semantic-operation-outcome"

import { semanticOperationOutcomeNotice } from "./semantic-operation-outcome"

const detail: SemanticOperationOutcomeDetail = {
  formId: "convert-opportunity-order",
  kind: "converged",
  resource: "sale-orders",
  recordId: "77",
  href: "/sales?tab=orders&filter=id%3A77",
  message: "Sales order ready.",
  actionLabel: "Open sales order",
  correlationId: "corr-77",
}

describe("semanticOperationOutcomeNotice", () => {
  it("keeps domain copy and opens the canonical result ref", () => {
    const navigate = vi.fn()
    const notice = semanticOperationOutcomeNotice(detail, navigate)

    expect(notice.kind).toBe("success")
    expect(notice.title).toBe("Sales order ready.")
    expect(notice.action?.label).toBe("Open sales order")

    notice.action?.onClick()
    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith("/sales?tab=orders&filter=id%3A77")
  })

  it("does not invent an action when the canonical href is absent", () => {
    const notice = semanticOperationOutcomeNotice(
      { ...detail, href: undefined },
      vi.fn(),
    )

    expect(notice.action).toBeUndefined()
  })
})
