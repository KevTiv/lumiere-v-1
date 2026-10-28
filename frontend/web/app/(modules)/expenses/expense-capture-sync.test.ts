import assert from "node:assert/strict"
import { OperationRequestError } from "@lumiere/api-client"
import test from "node:test"
import type { CreateExpenseParams } from "@lumiere/stdb/types"
import type { ExpenseCaptureOutboxItem } from "../../../lib/expense-capture-outbox"
import {
  CaptureReadbackError,
  capturePayloadToParams,
  resolveCaptureEffect,
  resolveCapturedExpense,
  syncExpenseCapture,
  type CaptureEffectRow,
} from "./expense-capture-sync"

const scope = { organizationId: 9n, companyId: 2n }
const file = new File(["real receipt bytes"], "receipt.pdf", {
  type: "application/pdf",
  lastModified: 1000,
})
const upload = {
  objectKey: "verified-object-key",
  checksum: "sha256-verified",
  fileName: file.name,
  mimetype: file.type,
  fileSize: BigInt(file.size),
  url: "https://example.test/blob",
}
function queued(): ExpenseCaptureOutboxItem {
  return {
    clientRequestId: "expense-capture-key",
    deviceId: "device",
    companyId: "2",
    createdAt: "2026-10-20T12:00:00Z",
    syncState: "queued",
    payload: {
      employeeId: "7",
      name: "Receipt capture",
      date: "2026-10-20",
      unitAmount: 12,
      quantity: 1,
      currencyId: "9007199254740993",
      hasReceipt: true,
      lineKind: "Standard",
    },
    receipt: {
      state: "queued",
      clientRequestId: "receipt-capture-key",
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      lastModified: file.lastModified,
    },
  }
}
function canonicalExpenseRow(payload = queued().payload): CaptureEffectRow {
  const params = capturePayloadToParams(payload, 2n, "expense-capture-key", [])
  return {
    id: "9007199254740995",
    organizationId: 9n,
    companyId: 2n,
    clientRequestId: params.clientRequestId,
    employeeId: params.employeeId,
    currencyId: params.currencyId,
    name: params.name,
    date: params.date,
    unitAmount: payload.lineKind === "Standard" ? params.unitAmount : 3,
    quantity:
      payload.lineKind === "Standard"
        ? params.quantity
        : payload.lineKind === "Mileage"
          ? payload.mileageDistance
          : payload.perDiemDays,
    description: params.description ?? null,
    taxIds: [],
    productId: null,
    accountId: null,
    analyticAccountId: null,
    projectId: params.projectId ?? null,
    lineKind: params.lineKind,
    paymentMode: params.paymentMode,
    merchantKey: params.merchantKey ?? null,
    mileageDistance: params.mileageDistance ?? null,
    mileageRateId: params.mileageRateId ?? null,
    perDiemDays: params.perDiemDays ?? null,
    perDiemRateId: params.perDiemRateId ?? null,
  }
}

function harness() {
  let saved = queued()
  const expenses: CaptureEffectRow[] = [],
    receipts: CaptureEffectRow[] = []
  const stages: ExpenseCaptureOutboxItem[] = []
  const calls = { upload: 0, register: 0, create: 0 }
  const services = {
    readExpenses: async () => expenses,
    readReceipts: async () => receipts,
    upload: async () => {
      calls.upload++
      return upload
    },
    register: async (params: {
      employeeId: bigint
      companyId: bigint
      storageKey: string
      clientRequestId: string
      contentHash: string
    }) => {
      calls.register++
      receipts.push({
        id: "9007199254740994",
        organizationId: 9n,
        companyId: params.companyId,
        employeeId: params.employeeId,
        clientRequestId: params.clientRequestId,
        storageKey: params.storageKey,
        contentHash: params.contentHash,
      })
      return 9007199254740994n
    },
    create: async (params: Partial<CreateExpenseParams>) => {
      calls.create++
      assert.deepEqual(params.attachmentIds, [9007199254740994n])
      assert.equal(params.currencyId, 9007199254740993n)
      expenses.push({
        ...canonicalExpenseRow(),
        id: "9007199254740995",
        organizationId: 9n,
        companyId: params.companyId,
        clientRequestId: params.clientRequestId,
        hasReceipt: Boolean(params.attachmentIds?.length),
        attachmentIds: params.attachmentIds,
      })
    },
    save: (next: ExpenseCaptureOutboxItem) => {
      saved = JSON.parse(JSON.stringify(next))
      stages.push(saved)
    },
  }
  return { services, expenses, receipts, stages, calls, current: () => saved }
}

test("capture resolver requires zero or one exact scoped key and rejects unsafe numeric identities", () => {
  assert.equal(resolveCaptureEffect([], scope, "key"), null)
  const row = {
    id: "9007199254740993",
    organizationId: 9n,
    companyId: 2n,
    clientRequestId: "key",
  }
  assert.equal(resolveCaptureEffect([row], scope, "key"), "9007199254740993")
  for (const rows of [
    [row, row],
    [{ ...row, companyId: 3n }],
    [{ id: 1, organizationId: 9, companyId: 2 }],
    [{ ...row, id: 9007199254740994 }],
  ])
    assert.throws(
      () => resolveCaptureEffect(rows, scope, "key"),
      CaptureReadbackError,
    )
})

test("upload and receipt checkpoints precede expense creation and keep u64 IDs exact", async () => {
  const h = harness(),
    result = await syncExpenseCapture(queued(), scope, file, h.services)
  assert.equal(result.syncState, "synced")
  assert.equal(result.expenseId, "9007199254740995")
  assert.deepEqual(h.calls, { upload: 1, register: 1, create: 1 })
  assert.equal(h.stages[0].receipt?.state, "uploading")
  assert.equal(h.stages[1].receipt?.uploaded?.objectKey, "verified-object-key")
  assert.equal(h.stages[2].receipt?.state, "attached")
  assert.equal(h.stages[3].syncState, "submitting")
})

test("reload before upload blocks synthetic receipt registration until original file is reattached", async () => {
  const h = harness()
  await assert.rejects(
    syncExpenseCapture(
      JSON.parse(JSON.stringify(queued())),
      scope,
      undefined,
      h.services,
    ),
    /Reattach the original/,
  )
  assert.deepEqual(h.calls, { upload: 0, register: 0, create: 0 })
  assert.equal(h.current().receipt?.state, "failed")
  assert.equal(h.current().syncState, "error")
})

test("registration failure plus reload reuses the completed upload and durable request identity", async () => {
  const h = harness(),
    register = h.services.register,
    requestIds: string[] = []
  h.services.register = async (params) => {
    requestIds.push(params.clientRequestId)
    throw new Error("Registration unavailable")
  }
  await assert.rejects(
    syncExpenseCapture(queued(), scope, file, h.services),
    /Registration unavailable/,
  )
  assert.equal(h.current().receipt?.uploaded?.checksum, "sha256-verified")
  const restored = JSON.parse(
    JSON.stringify(h.current()),
  ) as ExpenseCaptureOutboxItem
  h.services.register = async (params) => {
    requestIds.push(params.clientRequestId)
    return register(params)
  }
  assert.equal(
    (await syncExpenseCapture(restored, scope, undefined, h.services))
      .syncState,
    "synced",
  )
  assert.equal(h.calls.upload, 1)
  assert.deepEqual(requestIds, ["receipt-capture-key", "receipt-capture-key"])
})

test("lost create response is confirmed by exact readback without a second dispatch", async () => {
  const h = harness(),
    create = h.services.create
  h.services.create = async (params) => {
    await create(params)
    throw new Error("Response lost")
  }
  assert.equal(
    (await syncExpenseCapture(queued(), scope, file, h.services)).syncState,
    "synced",
  )
  assert.equal(
    (await syncExpenseCapture(h.current(), scope, undefined, h.services))
      .syncState,
    "synced",
  )
  assert.deepEqual(h.calls, { upload: 1, register: 1, create: 1 })
})

test("accepted command without exact readback stays unknown and checks never resend", async () => {
  const h = harness()
  h.services.create = async () => {
    h.calls.create++
  }
  const first = await syncExpenseCapture(queued(), scope, file, h.services)
  assert.equal(first.syncState, "unknown")
  assert.equal(
    (
      await syncExpenseCapture(
        JSON.parse(JSON.stringify(first)),
        scope,
        undefined,
        h.services,
      )
    ).syncState,
    "unknown",
  )
  assert.deepEqual(h.calls, { upload: 1, register: 1, create: 1 })
})

test("receipt checksum conflicts, duplicate identities and company switches fail before expense creation", async () => {
  for (const issue of ["checksum", "duplicate"] as const) {
    const h = harness(),
      row = {
        id: "5",
        organizationId: 9n,
        companyId: 2n,
        employeeId: 7n,
        clientRequestId: "receipt-capture-key",
        storageKey: "verified-object-key",
        contentHash: issue === "checksum" ? "other" : "sha256-verified",
      }
    h.receipts.push(row)
    if (issue === "duplicate") h.receipts.push({ ...row, id: "6" })
    await assert.rejects(
      syncExpenseCapture(queued(), scope, file, h.services),
      CaptureReadbackError,
    )
    assert.equal(h.calls.create, 0)
    assert.equal(h.calls.register, 0)
  }
  const h = harness()
  await assert.rejects(
    syncExpenseCapture(queued(), { ...scope, companyId: 3n }, file, h.services),
    CaptureReadbackError,
  )
  assert.deepEqual(h.calls, { upload: 0, register: 0, create: 0 })
})

test("durable checkpoint failure blocks the next remote side effect", async () => {
  const h = harness()
  h.services.save = (next) => {
    if (next.receipt?.uploaded) throw new Error("Storage quota exceeded")
  }
  await assert.rejects(
    syncExpenseCapture(queued(), scope, file, h.services),
    /Storage quota exceeded/,
  )
  assert.equal(h.calls.register, 0)
  assert.equal(h.calls.create, 0)
})

test("mileage capture ignores stale standard amount and preserves exact rate ID", () => {
  const params = capturePayloadToParams(
    {
      ...queued().payload,
      lineKind: "Mileage",
      mileageDistance: 5,
      mileageRateId: "9007199254740993",
      perDiemRateId: "4",
    },
    2n,
    "key",
    [],
  )
  assert.equal(params.unitAmount, 0)
  assert.equal(params.mileageRateId, 9007199254740993n)
  assert.equal(params.perDiemRateId, undefined)
})

test("expense confirmation requires the exact persisted receipt relation and never redispatches mismatched results", async () => {
  const item = queued()
  item.receipt!.receiptId = "9007199254740994"
  const row = {
    ...canonicalExpenseRow(),
    id: "20",
    organizationId: "9",
    companyId: "2",
    clientRequestId: item.clientRequestId,
    hasReceipt: true,
    attachmentIds: ["9007199254740994"],
  }
  assert.equal(resolveCapturedExpense([row], scope, item), "20")
  for (const wrong of [
    { ...row, hasReceipt: false },
    { ...row, attachmentIds: [] },
    { ...row, attachmentIds: ["21"] },
    { ...row, attachmentIds: ["9007199254740994", "9007199254740994"] },
    { ...row, attachmentIds: [9007199254740994] },
    {
      id: "20",
      organizationId: "9",
      companyId: "2",
      clientRequestId: item.clientRequestId,
    },
  ]) {
    const h = harness()
    h.expenses.push(wrong)
    await assert.rejects(
      syncExpenseCapture(item, scope, undefined, h.services),
      CaptureReadbackError,
    )
    assert.deepEqual(h.calls, { upload: 0, register: 0, create: 0 })
  }
  const noReceipt = {
    ...queued(),
    payload: { ...queued().payload, hasReceipt: false },
    receipt: undefined,
  }
  assert.equal(
    resolveCapturedExpense(
      [{ ...row, hasReceipt: false, attachmentIds: [] }],
      scope,
      noReceipt,
    ),
    "20",
  )
  assert.throws(
    () => resolveCapturedExpense([row], scope, noReceipt),
    CaptureReadbackError,
  )
})

test("same capture key with different submitted values cannot confirm an expense", async () => {
  const item = queued()
  item.receipt!.receiptId = "9007199254740994"
  const row = {
    ...canonicalExpenseRow(),
    hasReceipt: true,
    attachmentIds: ["9007199254740994"],
  }
  assert.equal(resolveCapturedExpense([row], scope, item), "9007199254740995")
  const mismatches: Partial<CaptureEffectRow>[] = [
    { employeeId: 8n },
    { currencyId: 4n },
    { name: "Other capture" },
    {
      date: {
        microsSinceUnixEpoch:
          BigInt(Date.parse(item.payload.date)) * 1000n + 1n,
      },
    },
    { date: { microsSinceUnixEpoch: Number.MAX_SAFE_INTEGER + 1 } },
    { unitAmount: 13 },
    { unitAmount: "12" },
    { quantity: 2 },
    { description: "Other description" },
    { taxIds: [1n] },
    { productId: 5n },
    { accountId: 5n },
    { analyticAccountId: 5n },
    { projectId: 5n },
    { lineKind: { tag: "Mileage" } },
    { paymentMode: { tag: "CorporateCard" } },
    { merchantKey: "Other merchant" },
    { mileageDistance: 5 },
    { mileageRateId: 5n },
    { perDiemDays: 5 },
    { perDiemRateId: 5n },
  ]
  for (const mismatch of mismatches) {
    const h = harness()
    h.expenses.push({ ...row, ...mismatch })
    await assert.rejects(
      syncExpenseCapture(item, scope, undefined, h.services),
      CaptureReadbackError,
    )
    assert.deepEqual(h.calls, { upload: 0, register: 0, create: 0 })
  }
  for (const key of [
    "employeeId",
    "currencyId",
    "name",
    "date",
    "unitAmount",
    "quantity",
    "description",
    "taxIds",
    "productId",
    "accountId",
    "analyticAccountId",
    "projectId",
    "lineKind",
    "paymentMode",
    "merchantKey",
    "mileageDistance",
    "mileageRateId",
    "perDiemDays",
    "perDiemRateId",
  ] as const) {
    const missing = { ...row }
    delete missing[key]
    assert.throws(
      () => resolveCapturedExpense([missing], scope, item),
      CaptureReadbackError,
    )
  }
})

test("rate captures compare submitted rate identity and units while leaving unit amount to the owner", () => {
  for (const lineKind of ["Mileage", "PerDiem"] as const) {
    const item = {
      ...queued(),
      payload: {
        ...queued().payload,
        hasReceipt: false,
        lineKind,
        mileageDistance: 5,
        mileageRateId: "7",
        perDiemDays: 2,
        perDiemRateId: "8",
      },
      receipt: undefined,
    }
    const row = {
      ...canonicalExpenseRow(item.payload),
      hasReceipt: false,
      attachmentIds: [],
    }
    assert.equal(resolveCapturedExpense([row], scope, item), "9007199254740995")
    assert.throws(
      () => resolveCapturedExpense([{ ...row, quantity: 99 }], scope, item),
      CaptureReadbackError,
    )
    assert.throws(
      () =>
        resolveCapturedExpense(
          [
            {
              ...row,
              [lineKind === "Mileage" ? "mileageRateId" : "perDiemRateId"]:
                "9007199254740993",
            },
          ],
          scope,
          item,
        ),
      CaptureReadbackError,
    )
  }
})

test("typed definite rejection is durable and allows only an explicit retry with the same upload and request identity", async () => {
  const h = harness(),
    create = h.services.create
  h.services.create = async () => {
    h.calls.create++
    throw new OperationRequestError({
      status: 422,
      code: "invalid_input",
      retry: "never",
      message: "Rate is inactive",
    })
  }
  const rejected = await syncExpenseCapture(queued(), scope, file, h.services)
  assert.equal(rejected.syncState, "rejected")
  assert.equal(rejected.lastError, "Rate is inactive")
  assert.equal(rejected.receipt?.state, "attached")
  assert.deepEqual(h.calls, { upload: 1, register: 1, create: 1 })
  h.services.create = create
  const retried = await syncExpenseCapture(
    JSON.parse(JSON.stringify(rejected)),
    scope,
    undefined,
    h.services,
  )
  assert.equal(retried.syncState, "synced")
  assert.equal(retried.clientRequestId, rejected.clientRequestId)
  assert.equal(
    retried.receipt?.clientRequestId,
    rejected.receipt?.clientRequestId,
  )
  assert.deepEqual(h.calls, { upload: 1, register: 1, create: 2 })
})

test("typed reconcile rejection remains unknown and cannot be explicitly redispatched", async () => {
  const h = harness()
  h.services.create = async () => {
    h.calls.create++
    throw new OperationRequestError({
      status: 503,
      code: "dependency_unavailable",
      retry: "reconcile",
      message: "Delivery status is unknown",
    })
  }
  const unknown = await syncExpenseCapture(queued(), scope, file, h.services)
  assert.equal(unknown.syncState, "unknown")
  assert.equal(
    (
      await syncExpenseCapture(
        JSON.parse(JSON.stringify(unknown)),
        scope,
        undefined,
        h.services,
      )
    ).syncState,
    "unknown",
  )
  assert.deepEqual(h.calls, { upload: 1, register: 1, create: 1 })
})

test("a payload collision after dispatch remains unresolved and cannot become success or resend", async () => {
  const h = harness(),
    create = h.services.create
  h.services.create = async (params) => {
    await create(params)
    h.expenses[0]!.currencyId = 55n
  }
  await assert.rejects(
    syncExpenseCapture(queued(), scope, file, h.services),
    CaptureReadbackError,
  )
  assert.equal(h.current().syncState, "unknown")
  await assert.rejects(
    syncExpenseCapture(h.current(), scope, undefined, h.services),
    CaptureReadbackError,
  )
  assert.equal(h.calls.create, 1)
})

test("generic retained actor mismatch stops before any remote read or write", async () => {
  const item = { ...queued(), formOrigin: { actorIdentity: "original", organizationId: "9", pricelistId: "4" } }
  let effects = 0
  await assert.rejects(syncExpenseCapture(item, { ...scope, actorIdentity: "other" }, file, {
    readExpenses: async () => { effects++; return [] }, readReceipts: async () => { effects++; return [] },
    upload: async () => { effects++; return upload }, register: async () => { effects++; return 1n }, create: async () => { effects++ }, save: () => { effects++ },
  }), /signed-in identity/)
  assert.equal(effects, 0)
})

test("full generic readback requires exact product, tax, account and analytic values", () => {
  const item = queued()
  item.payload = { ...item.payload, hasReceipt: false, productId: "10", taxIds: ["11", "12"], accountId: "13", analyticAccountId: "14" }
  const row = { ...canonicalExpenseRow(item.payload), hasReceipt: false, attachmentIds: [], productId: 10n, taxIds: [11n, 12n], accountId: 13n, analyticAccountId: 14n }
  assert.equal(resolveCapturedExpense([row], scope, item), "9007199254740995")
  for (const mismatch of [{ productId: 99n }, { taxIds: [11n] }, { accountId: null }, { analyticAccountId: 15n }]) {
    assert.throws(() => resolveCapturedExpense([{ ...row, ...mismatch }], scope, item), /submitted capture values/)
  }
})

test("local admission denial stays known unsent and resumes the original request after access returns", async () => {
  const item = queued()
  item.payload.hasReceipt = false
  let allowed = false, creates = 0
  let saved = item
  const services = {
    assertWriteAllowed: () => { if (!allowed) throw new Error("Local create permission is unavailable") },
    readExpenses: async () => creates ? [{ ...canonicalExpenseRow(item.payload), hasReceipt: false, attachmentIds: [] }] : [],
    readReceipts: async () => [], upload: async () => upload, register: async () => 1n,
    create: async () => { creates++ }, save: (next: ExpenseCaptureOutboxItem) => { saved = next },
  }
  await assert.rejects(syncExpenseCapture(item, scope, undefined, services), /Local create permission/)
  assert.equal(creates, 0)
  assert.equal(saved.syncState, "error")
  assert.equal(saved.clientRequestId, item.clientRequestId)
  allowed = true
  const result = await syncExpenseCapture(JSON.parse(JSON.stringify(saved)) as ExpenseCaptureOutboxItem, scope, undefined, services)
  assert.equal(creates, 1)
  assert.equal(result.syncState, "synced")
  assert.equal(result.clientRequestId, item.clientRequestId)
})
