import assert from "node:assert/strict"
import test from "node:test"

import {
  SEMANTIC_OPERATION_OUTCOME_EVENT,
  emitSemanticOperationOutcome,
  type SemanticOperationOutcomeDetail,
} from "../semantic-operation-outcome"
import { emitOpportunitySaleOrderOutcome } from "./crm-opportunity-conversion"

class TestCustomEvent<T> extends Event {
  readonly detail: T

  constructor(type: string, init: { detail: T }) {
    super(type)
    this.detail = init.detail
  }
}

function withTestWindow(run: (captured: SemanticOperationOutcomeDetail[]) => void): void {
  const captured: SemanticOperationOutcomeDetail[] = []
  const target = new EventTarget()
  target.addEventListener(SEMANTIC_OPERATION_OUTCOME_EVENT, (event) => {
    captured.push((event as TestCustomEvent<SemanticOperationOutcomeDetail>).detail)
  })

  const previousWindow = globalThis.window
  const previousCustomEvent = globalThis.CustomEvent
  Object.assign(globalThis, {
    window: target,
    CustomEvent: TestCustomEvent,
  })

  try {
    run(captured)
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window
    else Object.assign(globalThis, { window: previousWindow })
    if (previousCustomEvent === undefined) {
      delete (globalThis as { CustomEvent?: unknown }).CustomEvent
    } else {
      Object.assign(globalThis, { CustomEvent: previousCustomEvent })
    }
  }
}

test("semantic outcome bridge emits resolved data only", () => {
  withTestWindow((captured) => {
    emitSemanticOperationOutcome({
      formId: "test-form",
      kind: "converged",
      resource: "sale-orders",
      recordId: "44",
      href: "/sales?orderId=44",
      message: "Ready",
      actionLabel: "Open",
      correlationId: "corr-44",
    })

    assert.deepEqual(captured, [
      {
        formId: "test-form",
        kind: "converged",
        resource: "sale-orders",
        recordId: "44",
        href: "/sales?orderId=44",
        message: "Ready",
        actionLabel: "Open",
        correlationId: "corr-44",
      },
    ])
  })
})

test("CRM conversion emits form-scoped canonical Sales record feedback", () => {
  withTestWindow((captured) => {
    emitOpportunitySaleOrderOutcome({
      kind: "converged",
      ref: {
        resource: "sale-orders",
        id: "77",
        href: "/sales?orderId=77",
        opportunityId: "12",
        companyId: "3",
      },
      dispatch: "acknowledged",
      correlationId: "corr-77",
    })

    assert.equal(captured.length, 1)
    assert.deepEqual(captured[0], {
      formId: "convert-opportunity-order",
      kind: "converged",
      resource: "sale-orders",
      recordId: "77",
      href: "/sales?orderId=77",
      message: "Sales order ready.",
      actionLabel: "Open sales order",
      correlationId: "corr-77",
    })
  })
})

test("already-applied feedback points at the existing order without correlation overclaim", () => {
  withTestWindow((captured) => {
    emitOpportunitySaleOrderOutcome({
      kind: "already-applied",
      ref: {
        resource: "sale-orders",
        id: "88",
        href: "/sales?orderId=88",
        opportunityId: "12",
        companyId: "3",
      },
    })

    assert.deepEqual(captured[0], {
      formId: "convert-opportunity-order",
      kind: "already-applied",
      resource: "sale-orders",
      recordId: "88",
      href: "/sales?orderId=88",
      message: "This opportunity already has a sales order.",
      actionLabel: "Open sales order",
      correlationId: undefined,
    })
  })
})
