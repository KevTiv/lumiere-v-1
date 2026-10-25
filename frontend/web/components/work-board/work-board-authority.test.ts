import assert from "node:assert/strict"
import test from "node:test"
import {
  QueryClient,
  QueryObserver,
  type QueryKey,
} from "@tanstack/react-query"
import {
  workBoardQueryKey,
  type WorkBoardScope,
} from "@lumiere/query-hooks/hooks/work-board-model"
import { workActivitiesQueryKey } from "@lumiere/query-hooks/hooks/work-activities"
import { refreshWorkBoardAuthority } from "./work-board-authority"

const scope: WorkBoardScope = {
  organizationId: 7,
  companyId: 11,
  actorIdentity: "a".repeat(64),
  authorizationKey: "grant-1",
  scope: "finance",
  view: "eligible",
}
const authorityKey = ["auth-access", scope.organizationId, scope.actorIdentity]

function activeQuery(
  client: QueryClient,
  key: QueryKey,
  fetch: () => Promise<object>,
) {
  client.setQueryData(key, { retained: true })
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: fetch,
    staleTime: Infinity,
    retry: false,
  })
  return observer.subscribe(() => {})
}

test("reconnect refreshes authority before the exact scoped board and waits for both", async () => {
  const client = new QueryClient()
  const calls: string[] = []
  let release!: () => void
  const authority = new Promise<void>((resolve) => {
    release = resolve
  })
  const stopAuthority = activeQuery(client, authorityKey, async () => {
    calls.push("authority")
    await authority
    return { authorized: true }
  })
  const stopBoard = activeQuery(client, workBoardQueryKey(scope), async () => {
    calls.push("board")
    return { authorizedRows: [] }
  })
  try {
    const result = refreshWorkBoardAuthority(
      client,
      scope,
      "workflow",
      () => true,
    )
    assert.deepEqual(calls, ["authority"])
    release()
    assert.equal(await result, true)
    assert.deepEqual(calls, ["authority", "board"])
  } finally {
    stopAuthority()
    stopBoard()
    client.clear()
  }
})

test("missing or inactive authority data cannot certify a reconnect", async () => {
  const client = new QueryClient()
  try {
    await assert.rejects(
      refreshWorkBoardAuthority(client, scope, "workflow", () => true),
      /could not be refreshed/,
    )
    client.setQueryData(authorityKey, { authorized: true })
    await assert.rejects(
      refreshWorkBoardAuthority(client, scope, "workflow", () => true),
      /could not be refreshed/,
    )
  } finally {
    client.clear()
  }
})

test("revoked authority stops reconnect before any board read", async () => {
  const client = new QueryClient()
  let boardReads = 0
  const stopAuthority = activeQuery(client, authorityKey, async () => {
    throw new Error("revoked")
  })
  const stopBoard = activeQuery(client, workBoardQueryKey(scope), async () => {
    boardReads += 1
    return {}
  })
  try {
    await assert.rejects(
      refreshWorkBoardAuthority(client, scope, "workflow", () => true),
      /revoked/,
    )
    assert.equal(boardReads, 0)
  } finally {
    stopAuthority()
    stopBoard()
    client.clear()
  }
})

test("a board read failure after fresh authority keeps reconnect unconfirmed", async () => {
  const client = new QueryClient()
  const stopAuthority = activeQuery(client, authorityKey, async () => ({}))
  const stopBoard = activeQuery(
    client,
    workActivitiesQueryKey(scope),
    async () => {
      throw new Error("source access revoked")
    },
  )
  try {
    await assert.rejects(
      refreshWorkBoardAuthority(client, scope, "activities", () => true),
      /source access revoked/,
    )
  } finally {
    stopAuthority()
    stopBoard()
    client.clear()
  }
})

test("a context change during authority refresh prevents the obsolete board read", async () => {
  const client = new QueryClient()
  let current = true
  let boardReads = 0
  const stopAuthority = activeQuery(client, authorityKey, async () => {
    current = false
    return {}
  })
  const stopBoard = activeQuery(client, workBoardQueryKey(scope), async () => {
    boardReads += 1
    return {}
  })
  try {
    assert.equal(
      await refreshWorkBoardAuthority(client, scope, "workflow", () => current),
      false,
    )
    assert.equal(boardReads, 0)
  } finally {
    stopAuthority()
    stopBoard()
    client.clear()
  }
})
