import assert from "node:assert/strict"
import test from "node:test"
import {
  parseImportTaskStatuses,
  parseStoredImportTaskIds,
  readChatImportPostingStatus,
  readChatImportTaskStatus,
  scopedImportTaskStatuses,
} from "./import-task-status"
import { assistantAnswerMetadata, readAssistantStream } from "./assistant-turn"

const now = Date.parse("2026-11-07T12:00:00Z")
const status = {
  taskId: "a".repeat(32),
  companyId: "3",
  organizationId: "7",
  readAt: new Date(now).toISOString(),
  preparationStatus: "needs_review",
  sourceRows: { total: 7, ready: 4, held: 2, excluded: 1 },
  proposalCount: 1,
  proposals: [
    {
      id: "8",
      status: "verified",
      phase: "complete",
      expectedRecords: 2,
      verifiedResult: {
        recordCount: 2,
        lineCount: 4,
        totalDebit: "30.00",
        totalCredit: "30.00",
        currencyId: "9",
        postedCount: 0,
        verifiedAt: new Date(now).toISOString(),
      },
    },
  ],
}
const scope = { organizationId: 7, companyId: 3, taskIds: [status.taskId] }
const nativeResult = {
  requestId: "b".repeat(32),
  entity: "product",
  state: "receipt_available",
  verification: "native_receipt_only",
  receipt: {
    jobId: "11",
    status: "partial",
    totalRows: 5,
    rowsImported: 3,
    errorRows: 2,
  },
}

test("older authoritative import task citations supply read selectors only", () => {
  const taskId = status.taskId
  const source = {
    kind: "live" as const,
    trust: "authoritative" as const,
    entity_type: "import_task",
    source_kind: "import_task",
    entity_id: taskId,
    source_key: taskId,
  }
  assert.deepEqual(parseStoredImportTaskIds(null, [source]), [taskId])
  assert.equal(
    parseStoredImportTaskIds(null, [{ ...source, source_kind: "note" }]),
    undefined,
  )
  assert.equal(
    parseStoredImportTaskIds(null, [{ ...source, entity_id: "bad" }]),
    undefined,
  )
})

test("a saved import selector reopens 11 journal drafts without the model or any writes", async () => {
  const taskId = status.taskId
  const conversation = {
    identity: "actor",
    organizationId: 7,
    companyId: 3,
    conversationKey: "thread",
  }
  assert.deepEqual(
    parseStoredImportTaskIds(
      JSON.stringify({
        importTaskIds: [taskId, taskId],
        savedStatus: "posted",
      }),
    ),
    [taskId],
  )
  assert.equal(
    parseStoredImportTaskIds(JSON.stringify({ importTaskIds: ["../../task"] })),
    undefined,
  )
  assert.equal(
    parseStoredImportTaskIds(
      JSON.stringify({ importTaskIds: new Array(5).fill(taskId) }),
    ),
    undefined,
  )
  assert.equal(parseStoredImportTaskIds("bad JSON"), undefined)
  const entries = Array.from({ length: 11 }, (_, index) => ({
    itemId: String(index + 1),
    batchId: "71",
    sourceRevision: 2,
    sourceFile: "electricity.csv",
    sourceRow: index + 2,
    sourceSha256: "a".repeat(64),
    reference: `SOURCE-${index + 1}`,
    date: "2024-03-01",
    description: "Electricity expense",
    amount: index === 10 ? "82400" : "50000",
  }))
  const task = {
    organizationId: "7",
    companyId: "3",
    requestId: taskId,
    conversationKey: "thread",
    status: "needs_review",
    decision: {
      id: `${taskId}:purpose`,
      revision: 2,
      status: "approved",
      question: "How should these files be used?",
      options: [{ id: "prepare_import", label: "Prepare import" }],
      allowOther: true,
      selectedOptionId: "prepare_import",
      otherText: null,
      decisionId: "b".repeat(32),
    },
    decisionReceipt: null,
    decisionHistory: [],
    files: [
      {
        fileName: "electricity.csv",
        size: 9,
        sha256: "a".repeat(64),
        ordinal: 0,
      },
    ],
    reviews: [
      {
        id: "71",
        title: "Electricity",
        targetEntity: "source_observation",
        total: 11,
        pending: 0,
        confirmed: 11,
        excluded: 0,
      },
    ],
    warnings: [],
    error: null,
    createdAt: new Date(now).toISOString(),
  }
  const recordIds = entries.map((_, index) => String(100 + index))
  const workflow = {
    version: 1,
    requestId: taskId,
    companyId: "3",
    organizationId: "7",
    capabilities: [],
    proposals: [
      {
        id: "8",
        requestKey: "f".repeat(32),
        revision: 1,
        digest: "c".repeat(64),
        kind: "historical_expense_journals",
        status: "verified",
        createdAt: new Date(now).toISOString(),
        approvedAt: new Date(now).toISOString(),
        summary: {
          recordCount: 11,
          lineCount: 22,
          blockedCount: 0,
          totalDebit: "582400",
          totalCredit: "582400",
          currencyId: "2",
          dateFrom: "2024-03-01",
          dateTo: "2024-03-01",
        },
        sources: entries.map((entry) => ({
          itemId: entry.itemId,
          batchId: entry.batchId,
          revision: entry.sourceRevision,
        })),
        entries,
        issues: [],
        configuration: {
          journalId: "7",
          debitAccountId: "8",
          creditAccountId: "9",
          currencyId: "2",
          dateField: "date",
          amountField: "amount",
          descriptionField: null,
          postingDate: null,
          reason: "Historical electricity expense",
        },
        execution: {
          phase: "complete",
          parentRequestId: "d".repeat(32),
          lineRequestId: "e".repeat(32),
          parentJobId: "2",
          lineJobId: "3",
        },
        result: {
          verifiedAt: new Date(now).toISOString(),
          recordCount: 11,
          lineCount: 22,
          totalDebit: "582400",
          totalCredit: "582400",
          companyId: "3",
          currencyId: "2",
          recordIds,
          lineIds: Array.from({ length: 22 }, (_, index) =>
            String(200 + index),
          ),
          postedCount: 0,
        },
        lastError: null,
      },
    ],
  }
  const urls: string[] = []
  const fetcher = async (url: string, options?: RequestInit) => {
    assert.equal(options?.cache, "no-store")
    assert.equal(options?.method ?? "GET", "GET")
    urls.push(url)
    return Response.json(url.includes("/workflow?") ? workflow : task)
  }
  const restored = await readChatImportTaskStatus(fetcher, conversation, taskId)
  assert.deepEqual(restored.fileNames, ["electricity.csv"])
  const receipt = restored.proposals[0]?.verifiedResult
  assert.equal(receipt?.recordCount, 11)
  assert.equal(receipt?.lineCount, 22)
  assert.equal(receipt?.totalDebit, "582400")
  assert.equal(receipt?.postedCount, 0)
  assert.deepEqual(receipt?.records?.[10], {
    id: "110",
    reference: "SOURCE-11",
  })
  assert.deepEqual(urls, [
    `/api/import-tasks/${taskId}?companyId=3`,
    `/api/import-tasks/${taskId}/workflow?companyId=3`,
  ])
  await assert.rejects(
    readChatImportTaskStatus(
      fetcher,
      { ...conversation, conversationKey: "another" },
      taskId,
    ),
    /conversation/,
  )
  await assert.rejects(
    readChatImportTaskStatus(
      fetcher,
      { ...conversation, organizationId: 9 },
      taskId,
    ),
    /organization/,
  )
  const posting = {
    taskId,
    companyId: "3",
    organizationId: "7",
    proposalId: "8",
    recordCount: 11,
    postedCount: 6,
    draftCount: 4,
    otherCount: 0,
    unavailableCount: 1,
    checkedAt: new Date(now).toISOString(),
  }
  const outcome = await readChatImportPostingStatus(
    async (url, options) => {
      assert.equal(
        url,
        `/api/import-tasks/${taskId}/workflow/proposals/8/posting-status?companyId=3`,
      )
      assert.equal(options?.method ?? "GET", "GET")
      return Response.json(posting)
    },
    restored,
    restored.proposals[0]!,
  )
  assert.equal(outcome.postedCount, 6)
  assert.equal(outcome.unavailableCount, 1)
  await assert.rejects(
    readChatImportPostingStatus(
      async () => Response.json({ ...posting, unavailableCount: 0 }),
      restored,
      restored.proposals[0]!,
    ),
    /does not match/,
  )
})

test("deterministic task cards keep source decisions distinct from verified drafts", () => {
  const cards = parseImportTaskStatuses([
    { ...status, rawCells: "not forwarded", approval: "execute" },
  ])!
  assert.equal(cards[0]?.sourceRows.ready, 4)
  assert.equal(cards[0]?.proposals[0]?.verifiedResult?.recordCount, 2)
  assert.equal("rawCells" in cards[0]!, false)
  assert.deepEqual(cards[0]?.nativeResults, [])
  assert.equal(cards[0]?.nativeResultsMore, false)
  assert.deepEqual(scopedImportTaskStatuses(cards, scope, now), cards)
  assert.deepEqual(
    assistantAnswerMetadata({ sources: [], import_task_statuses: [status] })
      .importTasks,
    cards,
  )
})

test("stale, future, wrong-company, wrong-org and unrequested task cards are suppressed", () => {
  const cards = parseImportTaskStatuses([
    { ...status, nativeResults: [nativeResult] },
  ])!
  assert.deepEqual(scopedImportTaskStatuses(cards, scope, now + 300_000), [])
  assert.deepEqual(scopedImportTaskStatuses(cards, scope, now - 10_000), [])
  assert.deepEqual(
    scopedImportTaskStatuses(cards, { ...scope, companyId: 4 }, now),
    [],
  )
  assert.deepEqual(
    scopedImportTaskStatuses(cards, { ...scope, organizationId: 8 }, now),
    [],
  )
  assert.deepEqual(
    scopedImportTaskStatuses(cards, { ...scope, taskIds: [] }, now),
    [],
  )
})

test("native-only task projection preserves job evidence without implying Accounting readback", () => {
  const [card] = parseImportTaskStatuses([
    {
      ...status,
      proposalCount: 0,
      proposals: [],
      nativeResultsMore: true,
      nativeResults: [
        {
          ...nativeResult,
          verifiedResult: status.proposals[0]!.verifiedResult,
          currentRecordCount: 3,
        },
      ],
    },
  ])!
  assert.equal(card?.proposalCount, 0)
  assert.deepEqual(card?.proposals, [])
  assert.deepEqual(card?.nativeResults, [nativeResult])
  assert.equal(card?.nativeResultsMore, true)
  assert.deepEqual(scopedImportTaskStatuses([card!], scope, now), [card])
  for (const state of [
    "pending",
    "success",
    "partial",
    "failed",
    "rolled_back",
  ]) {
    const result = {
      ...nativeResult,
      receipt: { ...nativeResult.receipt, status: state },
    }
    assert.equal(
      parseImportTaskStatuses([{ ...status, nativeResults: [result] }])?.[0]
        ?.nativeResults[0]?.receipt?.status,
      state,
    )
  }
  const awaiting = { ...nativeResult, state: "awaiting_receipt", receipt: null }
  assert.equal(
    parseImportTaskStatuses([{ ...status, nativeResults: [awaiting] }])?.[0]
      ?.nativeResults[0]?.receipt,
    null,
  )
})

test("native projection rejects inconsistent, unbounded and stronger verification claims", () => {
  for (const patch of [
    { state: "awaiting_receipt" },
    { receipt: null },
    { verification: "full_erp_readback" },
    { entity: "account_move" },
    { requestId: "not-a-request" },
    { receipt: { ...nativeResult.receipt, jobId: "0" } },
    { receipt: { ...nativeResult.receipt, rowsImported: 6 } },
    { receipt: { ...nativeResult.receipt, errorRows: 6 } },
    { receipt: { ...nativeResult.receipt, totalRows: -1 } },
  ])
    assert.throws(() =>
      parseImportTaskStatuses([
        { ...status, nativeResults: [{ ...nativeResult, ...patch }] },
      ]),
    )
  assert.throws(() =>
    parseImportTaskStatuses([
      { ...status, nativeResults: [nativeResult, nativeResult] },
    ]),
  )
  assert.throws(() =>
    parseImportTaskStatuses([
      {
        ...status,
        nativeResults: Array.from({ length: 21 }, (_, index) => ({
          ...nativeResult,
          requestId: index.toString(16).padStart(32, "0"),
        })),
      },
    ]),
  )
})

test("verified labels require balanced and matching readback receipts", () => {
  assert.equal(
    parseImportTaskStatuses([
      {
        ...status,
        proposals: [
          {
            ...status.proposals[0],
            verifiedResult: {
              ...status.proposals[0]!.verifiedResult,
              totalCredit: "30.0000",
            },
          },
        ],
      },
    ])?.[0]?.proposals[0]?.status,
    "verified",
  )
  for (const patch of [
    { sourceRows: { total: 7, ready: 10, held: 2, excluded: 1 } },
    { proposals: [{ ...status.proposals[0], verifiedResult: null }] },
    { proposals: [{ ...status.proposals[0], status: "approved" }] },
    { proposals: [{ ...status.proposals[0], phase: "headers" }] },
    {
      proposals: [
        {
          ...status.proposals[0],
          verifiedResult: {
            ...status.proposals[0]!.verifiedResult,
            totalCredit: "31.00",
          },
        },
      ],
    },
    {
      proposals: [
        {
          ...status.proposals[0],
          verifiedResult: {
            ...status.proposals[0]!.verifiedResult,
            postedCount: 1,
          },
        },
      ],
    },
  ])
    assert.throws(() => parseImportTaskStatuses([{ ...status, ...patch }]))
})

test("completed chat streams preserve deterministic cards alongside withheld prose", async () => {
  const metadata = {
    sources: [],
    import_task_statuses: [{ ...status, nativeResults: [nativeResult] }],
  }
  const response = new Response(
    `event: delta\ndata: This answer was withheld.\n\nevent: sources\ndata: ${JSON.stringify(metadata)}\n\nevent: done\ndata: {}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  )
  const result = await readAssistantStream(response, (raw) =>
    assistantAnswerMetadata(JSON.parse(raw)),
  )
  assert.equal(result.answer, "This answer was withheld.")
  assert.equal(
    result.importTasks?.[0]?.proposals[0]?.verifiedResult?.recordCount,
    2,
  )
  assert.deepEqual(result.importTasks?.[0]?.nativeResults, [nativeResult])
})
