import assert from "node:assert/strict"
import test from "node:test"
import { QueryClient } from "@tanstack/react-query"
import { setSubscriptionReady } from "@lumiere/stdb/live"
import {
  FULL_CLIENT_SUBSCRIPTION_RESOURCES,
  subscriptionQueriesForResource,
} from "@lumiere/stdb/erp-subscriptions"

import {
  invalidateStdbQueryResources,
  isInvalidationOnlyResource,
  realtimeQueryKeysForResource,
} from "./stdb"
import { workBoardQueryKey, type WorkBoardScope } from "./work-board-model"
import { workActivitiesQueryKey } from "./work-activities"
import {
  API_REALTIME_WORK_RESOURCES,
  withAuthorizedWorkRealtimeResources,
  realtimeAuthorityKey,
  type RealtimeAuthorityState,
} from "./realtime"

function hasKey(keys: readonly unknown[], expected: unknown[]): boolean {
  return keys.some((key) => JSON.stringify(key) === JSON.stringify(expected))
}

test("calendar HTTP projection prefixes invalidate independently of direct subscription rows", () => {
  const qc = new QueryClient()
  setSubscriptionReady(true)
  try {
    const keys = ['calendar-events', 'activities', 'contacts'].map((resource) => [resource, '7', 'calendar-workspace', 'actor/company/policy'])
    const other = ['calendar-events', '8', 'calendar-workspace', 'actor/company/policy']
    for (const key of [...keys, other]) qc.setQueryData(key, [])
    invalidateStdbQueryResources(qc, 7, ['calendar-events', 'activities', 'contacts'])
    for (const key of keys) assert.equal(qc.getQueryState(key)?.isInvalidated, true)
    assert.equal(qc.getQueryState(other)?.isInvalidated, false)
    for (const key of keys) assert.equal(hasKey(realtimeQueryKeysForResource('auth', 7), key.slice(0, 3)), true)
  } finally {
    setSubscriptionReady(false)
    qc.clear()
  }
})

test("auth bundle invalidates concrete resources and settings views", () => {
  const keys = realtimeQueryKeysForResource("auth", 7)

  assert.equal(hasKey(keys, ["stdb", "user-profile", "7"]), true)
  assert.equal(hasKey(keys, ["user-role-assignment", "7"]), true)
  assert.equal(hasKey(keys, ["settings-roles", "7"]), true)
  assert.equal(hasKey(keys, ["settings-users", "7"]), true)
  assert.equal(hasKey(keys, ["user-role-assignments", "7"]), true)
  assert.equal(hasKey(keys, ["user-organizations", "7"]), true)
  assert.equal(hasKey(keys, ["current-user-profile"]), true)
  assert.equal(hasKey(keys, ["auth-access", 7]), true)
  assert.equal(hasKey(keys, ["workflow-human-tasks", "work-board", "7"]), true)
  assert.equal(hasKey(keys, ["activities", "work-board", "7"]), true)
})

test("authority and membership changes invalidate the scoped work projections", () => {
  for (const resource of [
    "user-role-assignment",
    "user-organization",
    "roles",
    "field-permissions",
    "org-permissions",
    "policy-snapshot",
  ]) {
    const keys = realtimeQueryKeysForResource(resource, 7n)
    assert.equal(hasKey(keys, ["auth-access", 7]), true, resource)
    assert.equal(
      hasKey(keys, ["workflow-human-tasks", "work-board", "7"]),
      true,
      resource,
    )
    assert.equal(
      hasKey(keys, ["activities", "work-board", "7"]),
      true,
      resource,
    )
  }
  for (const resource of ["departments", "employees", "companies"]) {
    const keys = realtimeQueryKeysForResource(resource, 7)
    assert.equal(
      hasKey(keys, ["workflow-human-tasks", "work-board", "7"]),
      true,
      resource,
    )
    assert.equal(
      hasKey(keys, ["activities", "work-board", "7"]),
      true,
      resource,
    )
  }
})

test("delegation, group eligibility, workflow state and source records invalidate affected boards", () => {
  for (const resource of [
    "workflow-human-tasks",
    "workflow-human-task-events",
    "workflow-instances",
    "workflow-versions",
    "workflow-candidate-group-members",
    "workflow-delegations",
    "purchase-approval-delegates",
  ]) {
    const keys = realtimeQueryKeysForResource(resource, 12)
    assert.equal(
      hasKey(keys, ["workflow-human-tasks", "work-board", "12"]),
      true,
      resource,
    )
    assert.equal(
      hasKey(keys, ["activities", "work-board", "12"]),
      false,
      resource,
    )
  }
  for (const resource of [
    "workflow-candidate-group-members",
    "workflow-delegations",
    "purchase-approval-delegates",
  ]) {
    assert.equal(
      hasKey(realtimeQueryKeysForResource(resource, 12), ["auth-access", 12]),
      true,
      resource,
    )
  }
  for (const resource of [
    "purchase-orders",
    "sale-orders",
    "account-moves",
    "expense-sheets",
  ]) {
    const keys = realtimeQueryKeysForResource(resource, 12)
    assert.equal(
      hasKey(keys, ["workflow-human-tasks", "work-board", "12"]),
      true,
      resource,
    )
    assert.equal(
      hasKey(keys, ["activities", "work-board", "12"]),
      true,
      resource,
    )
  }
})

test("private workflow resources use API invalidations without direct browser row subscriptions", () => {
  assert.deepEqual(API_REALTIME_WORK_RESOURCES, [
    "workflow-human-tasks",
    "workflow-candidate-group-members",
    "workflow-delegations",
  ])
  for (const resource of API_REALTIME_WORK_RESOURCES) {
    assert.equal(
      (FULL_CLIENT_SUBSCRIPTION_RESOURCES as readonly string[]).includes(
        resource,
      ),
      false,
      resource,
    )
    assert.equal(
      subscriptionQueriesForResource(resource, {
        organizationId: 7,
        companyIds: [11],
        identityHex: "a".repeat(64),
      }),
      null,
      resource,
    )
  }
})

test("workflow API resources are added only while the current actor can read workflow work", () => {
  const ordinary = ["auth", "account-moves"]
  assert.equal(withAuthorizedWorkRealtimeResources(ordinary, false), ordinary)
  const granted = withAuthorizedWorkRealtimeResources(ordinary, true)
  assert.deepEqual(granted, [...ordinary, ...API_REALTIME_WORK_RESOURCES])
  assert.deepEqual(withAuthorizedWorkRealtimeResources(granted, true), granted)
  assert.equal(withAuthorizedWorkRealtimeResources(ordinary, false), ordinary)
  assert.deepEqual(ordinary, ["auth", "account-moves"])
})

test("retained socket generations are isolated by organization, company and actor", () => {
  const qc = new QueryClient()
  const current = realtimeAuthorityKey(7, 11, "actor-a")
  try {
    qc.setQueryData<RealtimeAuthorityState>(current, {
      generation: 3,
      phase: "reconnecting",
    })
    assert.deepEqual(qc.getQueryData(current), {
      generation: 3,
      phase: "reconnecting",
    })
    for (const other of [
      realtimeAuthorityKey(8, 11, "actor-a"),
      realtimeAuthorityKey(7, 22, "actor-a"),
      realtimeAuthorityKey(7, 11, "actor-b"),
    ]) {
      assert.equal(qc.getQueryData(other), undefined)
    }
  } finally {
    qc.clear()
  }
})

test("realtime events match actual board cache keys without invalidating another organization", () => {
  const qc = new QueryClient()
  const scope: WorkBoardScope = {
    organizationId: 7,
    companyId: 11,
    actorIdentity: "a".repeat(64),
    authorizationKey: "grant",
    scope: "finance",
    view: "eligible",
  }
  const currentKeys = [
    workBoardQueryKey(scope),
    workActivitiesQueryKey(scope),
    ["auth-access", 7, scope.actorIdentity],
  ]
  const otherKeys = [
    workBoardQueryKey({ ...scope, organizationId: 8 }),
    workActivitiesQueryKey({ ...scope, organizationId: 8 }),
    ["auth-access", 8, scope.actorIdentity],
  ]
  try {
    for (const key of [...currentKeys, ...otherKeys])
      qc.setQueryData(key, { authorized: true })
    invalidateStdbQueryResources(qc, 7, ["auth"])
    for (const key of currentKeys)
      assert.equal(qc.getQueryState(key)?.isInvalidated, true)
    for (const key of otherKeys)
      assert.equal(qc.getQueryState(key)?.isInvalidated, false)
  } finally {
    qc.clear()
  }
})

test("HTTP work projections still refresh when direct subscriptions own ordinary row caches", () => {
  const qc = new QueryClient()
  const boardKey = ["workflow-human-tasks", "work-board", "7", "actor"]
  const activityKey = ["activities", "work-board", "7", "actor"]
  const rowKey = ["account-moves", "7"]
  try {
    for (const key of [boardKey, activityKey, rowKey]) qc.setQueryData(key, [])
    setSubscriptionReady(true)
    invalidateStdbQueryResources(qc, 7, ["account-moves"])
    assert.equal(qc.getQueryState(boardKey)?.isInvalidated, true)
    assert.equal(qc.getQueryState(activityKey)?.isInvalidated, true)
    assert.equal(qc.getQueryState(rowKey)?.isInvalidated, false)
  } finally {
    setSubscriptionReady(false)
    qc.clear()
  }
})

test("form configuration bundle invalidates each form cache", () => {
  const keys = realtimeQueryKeysForResource("form-configuration", 9n)

  for (const resource of [
    "form-configs",
    "form-config-fields",
    "form-role-configs",
    "user-custom-fields",
    "form-field-labels",
  ]) {
    assert.equal(hasKey(keys, ["stdb", resource, "9"]), true)
    assert.equal(hasKey(keys, [resource, "9"]), true)
  }
})

test("only bundles require HTTP cache invalidation while the row cache is active", () => {
  assert.equal(isInvalidationOnlyResource("auth"), true)
  assert.equal(isInvalidationOnlyResource("form-configuration"), true)
  assert.equal(isInvalidationOnlyResource("account-moves"), false)
})
