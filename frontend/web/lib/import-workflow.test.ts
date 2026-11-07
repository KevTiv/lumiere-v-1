import assert from "node:assert/strict"
import test from "node:test"
import {
  createImportProposalAttempt,
  dispatchImportProposalAttempt,
  parseImportProposalAttempt,
  readImportProposalAttempt,
  ImportWorkflowRequestError,
  parseImportProposal,
  prepareImportProposal,
  readImportWorkflow,
  transitionImportProposal,
  type ImportProposal,
  type PrepareImportProposal,
} from "./import-workflow"

const scope = { organizationId: 1, companyId: 3, taskId: "a".repeat(32) }
const configuration = {
  journalId: "7",
  debitAccountId: "8",
  creditAccountId: "9",
  currencyId: "2",
  dateField: "date",
  amountField: "amount",
  descriptionField: null,
  postingDate: null,
  reason: "Historical electricity, awaiting posting review",
}

function proposalFixture(): ImportProposal {
  return {
    id: "10",
    requestKey: "f".repeat(32),
    revision: 1,
    digest: "b".repeat(64),
    kind: "historical_expense_journals",
    status: "prepared",
    createdAt: "2026-11-07T00:00:00Z",
    approvedAt: null,
    summary: {
      recordCount: 2,
      lineCount: 4,
      blockedCount: 1,
      totalDebit: "0.3",
      totalCredit: "0.3",
      currencyId: "2",
      dateFrom: "2024-01-01",
      dateTo: "2024-01-02",
    },
    sources: [
      { itemId: "11", batchId: "20", revision: 2 },
      { itemId: "12", batchId: "20", revision: 2 },
      { itemId: "13", batchId: "20", revision: 1 },
    ],
    entries: ["0.1", "0.2"].map((amount, index) => ({
      itemId: String(11 + index),
      batchId: "20",
      sourceRevision: 2,
      sourceFile: "electricity.csv",
      sourceRow: index + 2,
      sourceSha256: "c".repeat(64),
      reference: `HISTORY-${index + 1}`,
      date: `2024-01-0${index + 1}`,
      description: "Electricity",
      amount,
    })),
    issues: [
      {
        itemId: "13",
        code: "unknown_date",
        message:
          "Confirm a transaction date or choose an explicit posting date.",
      },
    ],
    configuration: { ...configuration },
    execution: {
      phase: "not_started",
      parentRequestId: null,
      lineRequestId: null,
      parentJobId: null,
      lineJobId: null,
    },
    result: null,
    lastError: null,
  }
}

function verifiedFixture(): ImportProposal {
  const proposal = proposalFixture()
  return {
    ...proposal,
    status: "verified",
    approvedAt: "2026-11-07T01:00:00Z",
    execution: {
      phase: "complete",
      parentRequestId: "d".repeat(32),
      lineRequestId: "e".repeat(32),
      parentJobId: "30",
      lineJobId: "31",
    },
    result: {
      companyId: "3",
      currencyId: "2",
      verifiedAt: "2026-11-07T01:05:00Z",
      recordCount: 2,
      lineCount: 4,
      totalDebit: "0.3",
      totalCredit: "0.30",
      postedCount: 0,
      recordIds: ["9007199254740993", "9007199254740994"],
      lineIds: ["40", "41", "42", "43"],
    },
  }
}

const input: PrepareImportProposal = {
  ...configuration,
  descriptionField: undefined,
  postingDate: undefined,
  rows: [
    { itemId: "11", expectedRevision: 2 },
    { itemId: "12", expectedRevision: 2 },
    { itemId: "13", expectedRevision: 1 },
  ],
}

test("fixed decimal preview keeps ready rows and explicit holds independently", () => {
  const proposal = parseImportProposal(proposalFixture(), 3)
  assert.equal(proposal.summary.totalDebit, "0.3")
  assert.equal(proposal.summary.blockedCount, 1)
  assert.equal(proposal.result, null)
  assert.throws(
    () =>
      parseImportProposal(
        {
          ...proposal,
          summary: { ...proposal.summary, totalCredit: "0.300001" },
        },
        3,
      ),
    /preview does not match/,
  )
  assert.throws(
    () =>
      parseImportProposal(
        {
          ...proposal,
          entries: proposal.entries.map((entry) => ({
            ...entry,
            sourceRevision: 1,
          })),
        },
        3,
      ),
    /preview does not match/,
  )
  assert.throws(
    () =>
      parseImportProposal(
        { ...proposal, summary: { ...proposal.summary, blockedCount: 0 } },
        3,
      ),
    /preview does not match/,
  )
})

test("verified results require exact unique records, balanced totals, same company and no posted entries", () => {
  const proposal = verifiedFixture()
  assert.equal(
    parseImportProposal(proposal, 3).result?.recordIds[0],
    "9007199254740993",
  )
  assert.throws(
    () => parseImportProposal(proposal, 4),
    /readback does not match/,
  )
  assert.throws(
    () => parseImportProposal({ ...proposal, result: null }, 3),
    /incomplete/,
  )
  assert.throws(
    () => parseImportProposal({ ...proposal, status: "executing" }, 3),
    /incomplete/,
  )
  assert.throws(
    () =>
      parseImportProposal(
        {
          ...proposal,
          result: { ...proposal.result, recordIds: ["40", "40"] },
        },
        3,
      ),
    /readback does not match/,
  )
  assert.throws(() =>
    parseImportProposal(
      { ...proposal, result: { ...proposal.result, postedCount: 1 } },
      3,
    ),
  )
})

test("reloading a workflow rejects other task or company state", async () => {
  const body = {
    version: 1,
    requestId: scope.taskId,
    organizationId: "1",
    companyId: "3",
    capabilities: [],
    proposals: [verifiedFixture()],
  }
  const workflow = await readImportWorkflow(async (url, options) => {
    assert.equal(url, `/api/import-tasks/${scope.taskId}/workflow?companyId=3`)
    assert.equal(options?.cache, "no-store")
    return Response.json(body)
  }, scope)
  assert.equal(workflow.proposals[0]?.status, "verified")
  await assert.rejects(
    readImportWorkflow(
      async () => Response.json({ ...body, companyId: "4" }),
      scope,
    ),
    /another import or company/,
  )
  await assert.rejects(
    readImportWorkflow(
      async () => Response.json({ ...body, organizationId: "4" }),
      scope,
    ),
    /another import or company/,
  )
  await assert.rejects(
    readImportWorkflow(
      async () => Response.json({ ...body, requestId: "f".repeat(32) }),
      scope,
    ),
    /another import or company/,
  )
})

test("lost preparation response retries the same immutable request, while changed revisions receive a new identity", async () => {
  const keys: string[] = []
  const fetcher = async (_url: string, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body)) as {
      requestKey: string
      rows: unknown[]
    }
    keys.push(body.requestKey)
    assert.equal(body.rows.length, 3)
    if (keys.length === 1) throw new Error("Response lost after saving")
    return Response.json({ ...proposalFixture(), requestKey: body.requestKey })
  }
  await assert.rejects(
    prepareImportProposal(fetcher, scope, input),
    /Response lost/,
  )
  await prepareImportProposal(fetcher, scope, {
    ...input,
    rows: [...input.rows].reverse(),
  })
  assert.equal(keys[0], keys[1])
  await prepareImportProposal(fetcher, scope, {
    ...input,
    rows: input.rows.map((row) => ({ ...row, expectedRevision: 3 })),
  })
  assert.notEqual(keys[1], keys[2])
  await prepareImportProposal(fetcher, scope, {
    ...input,
    previousProposalId: "10",
  })
  assert.notEqual(keys[1], keys[3])
  await prepareImportProposal(fetcher, scope, {
    ...input,
    previousProposalId: "10",
  })
  assert.equal(keys[3], keys[4])
})

test("approval and resume carry the exact approved identity and never substitute a fresh native request", async () => {
  const proposal = proposalFixture()
  const result = await transitionImportProposal(
    async (url, options) => {
      assert.equal(
        url,
        `/api/import-tasks/${scope.taskId}/workflow/proposals/10/execute`,
      )
      assert.deepEqual(JSON.parse(String(options?.body)), {
        companyId: 3,
        expectedRevision: 1,
        expectedDigest: proposal.digest,
      })
      return Response.json({
        ...proposal,
        status: "executing",
        execution: {
          ...proposal.execution,
          phase: "headers",
          parentRequestId: "d".repeat(32),
        },
      })
    },
    scope,
    proposal,
    "execute",
  )
  assert.equal(result.status, "executing")
  assert.equal(result.result, null)
  await assert.rejects(
    transitionImportProposal(
      async () => Response.json({ ...proposal, digest: "f".repeat(64) }),
      scope,
      proposal,
      "approve",
    ),
    /does not match the approved preview/,
  )
})

test("invalid dates, repeated rows and oversized groups never reach the server", async () => {
  let calls = 0
  const fetcher = async () => {
    calls += 1
    return Response.json(proposalFixture())
  }
  await assert.rejects(
    prepareImportProposal(fetcher, scope, {
      ...input,
      postingDate: "2024-02-30",
    }),
  )
  await assert.rejects(
    prepareImportProposal(fetcher, scope, {
      ...input,
      rows: [input.rows[0]!, input.rows[0]!],
    }),
    /different source rows/,
  )
  await assert.rejects(
    prepareImportProposal(fetcher, scope, {
      ...input,
      rows: Array.from({ length: 201 }, (_, index) => ({
        itemId: String(index + 1),
        expectedRevision: 1,
      })),
    }),
    /1 to 200/,
  )
  assert.equal(calls, 0)
})

test("persisted preparation keeps exact intent after list refresh, reload and current form changes", async () => {
  const attempt = await createImportProposalAttempt(scope, {
    ...input,
    previousProposalId: "9",
  })
  const restored = parseImportProposalAttempt(JSON.stringify(attempt))
  const currentForm = {
    ...input,
    previousProposalId: "10",
    reason: "A changed mapping must not replace an unresolved request",
  }
  assert.notEqual(
    (await createImportProposalAttempt(scope, currentForm)).requestKey,
    restored.requestKey,
  )
  let posted: Record<string, unknown> | null = null
  const saved = await dispatchImportProposalAttempt(
    async (_url, options) => {
      posted = JSON.parse(String(options?.body))
      return Response.json({
        ...proposalFixture(),
        requestKey: attempt.requestKey,
      })
    },
    scope,
    restored,
  )
  assert.equal(saved.requestKey, attempt.requestKey)
  assert.equal(posted?.["reason"], input.reason)
  assert.equal(posted?.["requestKey"], attempt.requestKey)
  await assert.rejects(
    dispatchImportProposalAttempt(
      async () => {
        throw new Error("must not dispatch")
      },
      { ...scope, companyId: 4 },
      restored,
    ),
    /does not match this company/,
  )
})

test("exact preparation lookup distinguishes absent, inaccessible and mismatched receipts", async () => {
  const attempt = await createImportProposalAttempt(scope, input)
  assert.equal(
    await readImportProposalAttempt(
      async () => new Response(null, { status: 404 }),
      scope,
      attempt.requestKey,
    ),
    null,
  )
  await assert.rejects(
    readImportProposalAttempt(
      async () => Response.json({ error: "Access changed" }, { status: 403 }),
      scope,
      attempt.requestKey,
    ),
    (error: unknown) =>
      error instanceof ImportWorkflowRequestError && error.status === 403,
  )
  await assert.rejects(
    readImportProposalAttempt(
      async () => Response.json(proposalFixture()),
      scope,
      attempt.requestKey,
    ),
    /another preparation request/,
  )
  const found = await readImportProposalAttempt(
    async (url, options) => {
      assert.equal(
        url,
        `/api/import-tasks/${scope.taskId}/workflow/requests/${attempt.requestKey}?companyId=3`,
      )
      assert.equal(options?.cache, "no-store")
      return Response.json({
        ...proposalFixture(),
        requestKey: attempt.requestKey,
      })
    },
    scope,
    attempt.requestKey,
  )
  assert.equal(found?.id, "10")
})

test("native import receipts stay distinct from verified Accounting readback", async () => {
  const receipt = {
    requestId: "c".repeat(32),
    entity: "product",
    fileName: "products.csv",
    contentSha256: "d".repeat(64),
    reviewItemCount: 3,
    reviewIds: ["20"],
    submittedAt: "2026-11-07T00:00:00Z",
    state: "receipt_available",
    verification: "native_receipt_only",
    receipt: {
      jobId: "9007199254740993",
      status: "partial",
      totalRows: 3,
      rowsImported: 2,
      errorRows: 1,
    },
  }
  const body = {
    version: 1,
    requestId: scope.taskId,
    organizationId: "1",
    companyId: "3",
    capabilities: [],
    proposals: [],
    nativeResults: [receipt],
    nativeResultsMore: true,
  }
  const workflow = await readImportWorkflow(
    async () => Response.json(body),
    scope,
  )
  assert.equal(workflow.proposals.length, 0)
  assert.equal(workflow.nativeResults[0]?.verification, "native_receipt_only")
  assert.equal(workflow.nativeResults[0]?.receipt?.jobId, "9007199254740993")
  assert.equal(workflow.nativeResultsMore, true)
  await assert.rejects(
    readImportWorkflow(
      async () =>
        Response.json({
          ...body,
          nativeResults: [{ ...receipt, receipt: null }],
        }),
      scope,
    ),
    /inconsistent status/,
  )
  await assert.rejects(
    readImportWorkflow(
      async () =>
        Response.json({
          ...body,
          nativeResults: [{ ...receipt, verification: "verified" }],
        }),
      scope,
    ),
  )
})

test("a distinct expense decision changes the frozen request and preserves the compared evidence", async () => {
  const proposal = proposalFixture()
  const candidate = {
    origin: "saved_proposal" as const,
    proposalId: "5",
    proposalDigest: "d".repeat(64),
    itemId: "44",
    sourceRevision: 3,
    reason: "overlapping_period_amount" as const,
    dateFrom: "2024-01-01",
    dateToExclusive: "2024-01-02",
    postingDate: "2024-01-01",
    amount: "0.1",
    currencyId: "2",
    externalReference: null,
    category: "Electricity",
  }
  const issue = {
    itemId: "13",
    code: "overlapping_expense",
    message: "Compare these expenses.",
    candidates: [candidate],
    resolution: {
      kind: "distinct_expenses" as const,
      candidateDigest: "e".repeat(64),
    },
  }
  assert.deepEqual(
    parseImportProposal({ ...proposal, issues: [issue] }, 3).issues[0]
      ?.candidates,
    [candidate],
  )
  assert.throws(
    () =>
      parseImportProposal(
        {
          ...proposal,
          issues: [
            { ...issue, candidates: [{ ...candidate, proposalId: null }] },
          ],
        },
        3,
      ),
    /missing its saved proposal identity/,
  )
  const original = await createImportProposalAttempt(scope, input)
  const decision = {
    itemId: "13",
    sourceRevision: 1,
    candidateDigest: "e".repeat(64),
    reason: "Separate dated supplier receipts, both reviewed.",
  }
  const resolved = await createImportProposalAttempt(scope, {
    ...input,
    distinctExpenses: [decision],
  })
  assert.notEqual(original.requestKey, resolved.requestKey)
  assert.deepEqual(
    parseImportProposalAttempt(JSON.stringify(resolved)).input.distinctExpenses,
    [decision],
  )
  const changed = await createImportProposalAttempt(scope, {
    ...input,
    distinctExpenses: [{ ...decision, candidateDigest: "f".repeat(64) }],
  })
  assert.notEqual(resolved.requestKey, changed.requestKey)
})
