import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  resolveHelpdeskTicketLifecycleEffect,
  type HelpdeskTicketLifecycleProjection,
} from "./helpdesk"
import { AmbiguousOperationEffectError } from "./operation-effect"

const ticket: HelpdeskTicketLifecycleProjection = {
  id: "41",
  organizationId: "7",
  userId: { __identity__: "aabbcc" },
  state: { tag: "InProgress" },
  closedAt: null,
}

describe("COV-14 helpdesk lifecycle exact effects", () => {
  it("resolves the assigned agent on the same in-progress ticket", () => {
    assert.deepEqual(
      resolveHelpdeskTicketLifecycleEffect(
        [ticket],
        7n,
        41n,
        "InProgress",
        "0xAABBCC",
      ),
      {
        resource: "helpdesk-tickets",
        id: "41",
        state: "InProgress",
        assigneeIdentityHex: "aabbcc",
      },
    )
  })

  it("resolves close only with a persisted closed_at", () => {
    assert.deepEqual(
      resolveHelpdeskTicketLifecycleEffect(
        [{ ...ticket, state: { closed: [] }, closedAt: { some: 123 } }],
        7n,
        41n,
        "Closed",
      ),
      {
        resource: "helpdesk-tickets",
        id: "41",
        state: "Closed",
        assigneeIdentityHex: "aabbcc",
      },
    )
    assert.equal(
      resolveHelpdeskTicketLifecycleEffect(
        [{ ...ticket, state: "Closed", closedAt: null }],
        7n,
        41n,
        "Closed",
      ),
      null,
    )
  })

  it("resolves reopen only after closed_at is cleared", () => {
    assert.deepEqual(
      resolveHelpdeskTicketLifecycleEffect(
        [{ ...ticket, state: "InProgress", closedAt: { none: [] } }],
        7n,
        41n,
        "InProgress",
      ),
      {
        resource: "helpdesk-tickets",
        id: "41",
        state: "InProgress",
        assigneeIdentityHex: "aabbcc",
      },
    )
    assert.equal(
      resolveHelpdeskTicketLifecycleEffect(
        [{ ...ticket, state: "InProgress", closedAt: { some: 123 } }],
        7n,
        41n,
        "InProgress",
      ),
      null,
    )
  })

  it("fails closed for wrong scope, assignee, state, or duplicate identity", () => {
    assert.equal(
      resolveHelpdeskTicketLifecycleEffect(
        [{ ...ticket, organizationId: "9" }],
        7n,
        41n,
        "InProgress",
        "aabbcc",
      ),
      null,
    )
    assert.equal(
      resolveHelpdeskTicketLifecycleEffect(
        [ticket],
        7n,
        41n,
        "InProgress",
        "ddeeff",
      ),
      null,
    )
    assert.equal(
      resolveHelpdeskTicketLifecycleEffect(
        [ticket],
        7n,
        41n,
        "Closed",
      ),
      null,
    )
    assert.throws(
      () =>
        resolveHelpdeskTicketLifecycleEffect(
          [ticket, { ...ticket }],
          7n,
          41n,
          "InProgress",
        ),
      AmbiguousOperationEffectError,
    )
  })
})
