import assert from "node:assert/strict"
import test from "node:test"
import {
  parseImportTaskStatuses,
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
