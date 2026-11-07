import assert from "node:assert/strict"
import test from "node:test"
import {
  applyImportRecipe,
  listImportRecipes,
  reprepareImportTask,
  saveImportRecipe,
} from "./import-preparation-client"
import type { ImportPreparation, ImportRecipe } from "./import-preparation"
import type { ChatImportTask } from "./chat-import-task"

const scope = {
  actor: "operator",
  organizationId: 1,
  companyId: 2,
  taskId: "a".repeat(32),
}
const preparation: ImportPreparation = {
  version: 1,
  files: [
    {
      fileName: "expenses.csv",
      sourceSha256: "b".repeat(64),
      dateOrder: "dmy",
      decimalSeparator: ",",
    },
  ],
}
const recipe: ImportRecipe = {
  companyId: "2",
  key: "shop-expenses",
  name: "Shop expenses",
  version: 1,
  sha256: "c".repeat(64),
  createdAt: "2026-11-07T10:00:00Z",
  slots: [
    {
      key: "source-1",
      label: "expenses.csv",
      format: "csv",
      options: {
        dateOrder: "dmy",
        decimalSeparator: ",",
        expectedLayoutSha256: "d".repeat(64),
      },
    },
  ],
}

function task(requestId: string, rules: ImportPreparation): ChatImportTask {
  return {
    requestId,
    companyId: "2",
    conversationKey: "original-conversation",
    status: "needs_review",
    error: null,
    warnings: [],
    createdAt: "2026-11-07T11:00:00Z",
    decision: {
      id: `${requestId}:purpose`,
      revision: 2,
      status: "approved",
      question: "Prepare files?",
      allowOther: true,
      options: [
        { id: "prepare_import", label: "Prepare" },
        { id: "inspect_only", label: "Inspect" },
      ],
      selectedOptionId: "prepare_import",
      otherText: null,
      decisionId: "e".repeat(32),
    },
    decisionReceipt: null,
    decisionHistory: [],
    files: rules.files.map((file, ordinal) => ({
      ordinal,
      fileName: file.fileName,
      sha256: file.sourceSha256,
      size: 123,
    })),
    reviews: [
      {
        id: "10",
        title: "New review",
        targetEntity: "source_observation",
        total: 1,
        pending: 1,
        confirmed: 0,
        excluded: 0,
      },
    ],
    preparation: rules,
  }
}

test("lost preparation response recovers its exact task receipt without another POST", async () => {
  let saved: ChatImportTask | null = null
  const calls: string[] = []
  const result = await reprepareImportTask(
    async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`)
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body))
        assert.equal(body.companyId, 2)
        assert.equal(url, `/api/import-tasks/${scope.taskId}/reprepare`)
        saved = task(body.requestId, body.preparation)
        throw new Error("Reply lost after save")
      }
      assert.equal(url, `/api/import-tasks/${saved!.requestId}?companyId=2`)
      return Response.json(saved)
    },
    scope,
    preparation,
  )
  assert.equal(calls.length, 2)
  assert.equal(result.reviews[0]!.confirmed, 0)
  assert.deepEqual(result.preparation, preparation)
})

test("unknown outcomes retain one deterministic request while changed choices create another", async () => {
  const identities: string[] = []
  const fetcher = async (_url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return Response.json({}, { status: 404 })
    const body = JSON.parse(String(init.body))
    identities.push(body.requestId)
    if (identities.length === 1) throw new Error("Offline")
    return Response.json(task(body.requestId, body.preparation))
  }
  await assert.rejects(
    reprepareImportTask(fetcher, scope, preparation),
    /outcome is still unknown/,
  )
  await reprepareImportTask(fetcher, scope, {
    files: preparation.files,
    version: 1,
  })
  await reprepareImportTask(fetcher, scope, {
    version: 1,
    files: [{ ...preparation.files[0]!, dateOrder: "mdy" }],
  })
  assert.equal(identities[0], identities[1])
  assert.notEqual(identities[1], identities[2])
})

test("permission and stale-version refusals do not retry mutations or read unrelated receipts", async () => {
  for (const status of [403, 409]) {
    let calls = 0
    await assert.rejects(
      reprepareImportTask(
        async () => {
          calls++
          return Response.json(
            { error: "Reopen this task in its original scope." },
            { status },
          )
        },
        scope,
        preparation,
      ),
      /original scope/,
    )
    assert.equal(calls, 1)
  }
})

test("recipe saves recover the exact save receipt even when the latest version has changed", async () => {
  let expectedReceipt = ""
  const saved = await saveImportRecipe(
    async (url, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body))
        assert.equal(body.sourceRequestId, scope.taskId)
        assert.equal(body.expectedVersion, 0)
        expectedReceipt = `/api/import-recipes/requests/${body.requestId}?companyId=2`
        throw new Error("Reply lost after immutable version save")
      }
      assert.equal(url, expectedReceipt)
      return Response.json(recipe)
    },
    scope,
    { key: recipe.key, name: ` ${recipe.name} `, expectedVersion: 0 },
  )
  assert.equal(saved.version, 1)
  assert.equal(saved.name, recipe.name)
})

test("recipe save identity is stable across callers and includes the expected version", async () => {
  const ids: string[] = []
  const fetcher = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    ids.push(body.requestId)
    return Response.json({ ...recipe, version: body.expectedVersion + 1 })
  }
  await saveImportRecipe(fetcher, scope, {
    key: recipe.key,
    name: recipe.name,
    expectedVersion: 0,
  })
  await saveImportRecipe(fetcher, scope, {
    expectedVersion: 0,
    name: recipe.name,
    key: recipe.key,
  })
  await saveImportRecipe(fetcher, scope, {
    key: recipe.key,
    name: recipe.name,
    expectedVersion: 1,
  })
  assert.equal(ids[0], ids[1])
  assert.notEqual(ids[1], ids[2])
})

test("applying a recipe validates exact rules in the recovered new task", async () => {
  let saved: ChatImportTask | null = null
  const result = await applyImportRecipe(
    async (_url, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body))
        assert.deepEqual(body.bindings, [{ slotKey: "source-1", ordinal: 0 }])
        assert.equal(body.version, 1)
        saved = task(body.requestId, {
          version: 1,
          recipe: { key: recipe.key, version: 1 },
          files: [
            {
              fileName: "next-export.csv",
              sourceSha256: "f".repeat(64),
              ...recipe.slots[0]!.options,
            },
          ],
        })
        throw new Error("Reply lost")
      }
      return Response.json(saved)
    },
    scope,
    recipe,
    [{ slotKey: "source-1", ordinal: 0 }],
  )
  assert.equal(result.preparation!.recipe!.version, 1)
  assert.equal(result.preparation!.files[0]!.sourceSha256, "f".repeat(64))
  assert.equal(result.reviews[0]!.confirmed, 0)
})

test("invalid bindings, cross-company recipes and mismatched source rules fail closed", async () => {
  let calls = 0
  const fetcher = async () => {
    calls++
    return Response.json(recipe)
  }
  await assert.rejects(
    applyImportRecipe(fetcher, scope, recipe, [
      { slotKey: "unknown", ordinal: 0 },
    ]),
    /Match each/,
  )
  await assert.rejects(
    applyImportRecipe(fetcher, { ...scope, companyId: 3 }, recipe, [
      { slotKey: "source-1", ordinal: 0 },
    ]),
    /Match each/,
  )
  assert.equal(calls, 0)
  await assert.rejects(
    listImportRecipes(
      async () => Response.json({ recipes: [{ ...recipe, companyId: "3" }] }),
      scope,
    ),
    /another company/,
  )
  let requestId = ""
  await assert.rejects(
    reprepareImportTask(
      async (_url, init) => {
        if (init?.method === "POST")
          requestId = JSON.parse(String(init.body)).requestId
        return Response.json(
          task(requestId, {
            version: 1,
            files: [{ ...preparation.files[0]!, dateOrder: "mdy" }],
          }),
        )
      },
      scope,
      preparation,
    ),
    /outcome is still unknown/,
  )
})
