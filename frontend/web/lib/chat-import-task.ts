import { z } from "zod"

const requestId = z.string().regex(/^[0-9a-f]{32}$/)
const positiveId = z.string().regex(/^[1-9]\d*$/)
const sourceSchema = z.object({
  fileName: z.string().min(1).max(255),
  size: z.number().int().positive().max(5_000_000),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
})
const decisionOption = z.enum(["prepare_import", "inspect_only", "other"])
const decisionReceiptSchema = z.object({
  decisionId: requestId, optionId: decisionOption, otherText: z.string().nullable(),
  revision: z.number().int().positive(), createdAt: z.string(),
})
const taskSchema = z.object({
  requestId,
  companyId: positiveId,
  conversationKey: z.string().min(1).max(150),
  status: z.enum(["awaiting_decision", "saved", "needs_review", "inspection_ready", "failed"]),
  decision: z.object({
    id: z.string().min(1).max(200), revision: z.number().int().positive(), status: z.enum(["pending", "approved"]),
    question: z.string().min(1), options: z.array(z.object({ id: z.enum(["prepare_import", "inspect_only"]), label: z.string().min(1) })).min(1).max(2),
    allowOther: z.literal(true), selectedOptionId: decisionOption.nullable(), otherText: z.string().nullable(), decisionId: requestId.nullable(),
  }),
  decisionReceipt: decisionReceiptSchema.nullable(),
  decisionHistory: z.array(decisionReceiptSchema).max(100),
  files: z.array(sourceSchema.extend({
    ordinal: z.number().int().nonnegative(),
    previousMatch: sourceSchema.pick({ fileName: true, sha256: true }).extend({
      kind: z.enum(["identical", "same_name"]),
      requestId,
      ordinal: z.number().int().nonnegative().max(19),
    }).nullish(),
  })).min(1).max(20),
  reviews: z.array(z.object({
    id: positiveId, title: z.string(), targetEntity: z.string(),
    total: z.number().int().nonnegative(), pending: z.number().int().nonnegative(),
    confirmed: z.number().int().nonnegative(), excluded: z.number().int().nonnegative(),
  })),
  warnings: z.array(z.string()),
  error: z.string().nullable(),
  createdAt: z.string(),
})
export type ChatImportTask = z.infer<typeof taskSchema>
export interface ChatImportScope {
  identity: string
  organizationId: number
  companyId: number
  conversationKey: string
}
const pointerSchema = z.object({ requestId, files: z.array(sourceSchema).min(1).max(20) }).strict()
export type ChatImportPointer = z.infer<typeof pointerSchema>
const decisionPointerSchema = z.object({
  taskRequestId: requestId, questionId: z.string().min(1).max(200), decisionId: requestId,
  expectedRevision: z.number().int().positive(), optionId: decisionOption, otherText: z.string().optional(),
}).strict()
export type ChatImportDecisionPointer = z.infer<typeof decisionPointerSchema>
export type ChatImportDecisionAnswer = Pick<ChatImportDecisionPointer, "expectedRevision" | "optionId" | "otherText"> & { requestId: string }
type ReceiptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">
export type ImportTaskFetch = (url: string, init?: RequestInit) => Promise<Response>

export function chatImportScopeKey(scope: ChatImportScope): string {
  if (!scope.identity || !Number.isSafeInteger(scope.organizationId) || scope.organizationId < 1
    || !Number.isSafeInteger(scope.companyId) || scope.companyId < 1
    || !/^[a-zA-Z0-9_-]{1,150}$/.test(scope.conversationKey)) throw new Error("Select a company and conversation before importing files.")
  return `lumiere:chat-import:v1:${JSON.stringify([scope.identity, scope.organizationId, scope.companyId, scope.conversationKey])}`
}

export function readChatImportPointer(storage: ReceiptStorage, scope: ChatImportScope): ChatImportPointer | null {
  const raw = storage.getItem(chatImportScopeKey(scope))
  return raw ? pointerSchema.parse(JSON.parse(raw)) : null
}

export function parseChatImportTask(value: unknown, scope: ChatImportScope, expectedRequest?: string): ChatImportTask {
  const task = taskSchema.parse(value)
  if (task.companyId !== String(scope.companyId) || task.conversationKey !== scope.conversationKey
    || (expectedRequest && task.requestId !== expectedRequest)
    || task.files.some((source, index) => source.ordinal !== index)) throw new Error("The saved import does not match this company or conversation.")
  if (task.decision.id !== `${task.requestId}:purpose`
    || new Set(task.decision.options.map(option => option.id)).size !== task.decision.options.length
    || (task.status === "awaiting_decision") !== (task.decision.status === "pending")
    || (task.decision.status === "pending" && task.reviews.length > 0)) throw new Error("The saved file decision is inconsistent. Check the original task before continuing.")
  return task
}

export async function readChatImportTask(fetcher: ImportTaskFetch, scope: ChatImportScope, id: string): Promise<ChatImportTask | null> {
  requestId.parse(id)
  const response = await fetcher(`/api/import-tasks/${id}?companyId=${scope.companyId}`, { cache: "no-store" })
  if (response.status === 404) return null
  if (!response.ok) throw new Error("The saved import could not be checked. Keep this submission and check again.")
  return parseChatImportTask(await response.json(), scope, id)
}

export async function listChatImportTasks(fetcher: ImportTaskFetch, scope: ChatImportScope): Promise<ChatImportTask[]> {
  const query = new URLSearchParams({ companyId: String(scope.companyId), conversationKey: scope.conversationKey })
  const response = await fetcher(`/api/import-tasks?${query}`, { cache: "no-store" })
  if (!response.ok) throw new Error(response.status === 403
    ? "File imports require an unrestricted company administrator."
    : "File import preparation is unavailable. Check again to restore saved work.")
  const body = z.object({ tasks: z.array(z.unknown()).max(100) }).parse(await response.json())
  return body.tasks.map(task => parseChatImportTask(task, scope))
}

export function verifyImportSources(task: ChatImportTask, pointer: ChatImportPointer): void {
  if (task.requestId !== pointer.requestId || task.files.length !== pointer.files.length
    || task.files.some((source, i) => source.fileName !== pointer.files[i].fileName
      || source.size !== pointer.files[i].size || source.sha256 !== pointer.files[i].sha256)) {
    throw new Error("The saved import does not match the original files. Your submission receipt is retained.")
  }
}

function base64(bytes: Uint8Array): string {
  let encoded = ""
  for (let offset = 0; offset < bytes.length; offset += 32_768) encoded += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  return btoa(encoded)
}

/** Save only receipt fingerprints locally. Original bytes belong to the authorized server task. */
export async function submitChatImportFiles(args: {
  files: File[]; scope: ChatImportScope; storage: ReceiptStorage; fetcher: ImportTaskFetch;
  isCurrent: () => boolean; createRequestId?: () => string; knownTasks?: ChatImportTask[];
}): Promise<ChatImportTask> {
  const assertCurrent = () => { if (!args.isCurrent()) throw new Error("The active company or conversation changed. Reopen the import in its original company.") }
  assertCurrent()
  const key = chatImportScopeKey(args.scope)
  if (!args.files.length || args.files.length > 20 || args.files.reduce((sum, file) => sum + file.size, 0) > 20_000_000
    || args.files.some(file => !/\.(csv|xlsx)$/i.test(file.name) || !file.size || file.size > 5_000_000
      || new TextEncoder().encode(file.name).length > 255 || /[\u0000-\u001f\u007f-\u009f/\\]/.test(file.name))) {
    throw new Error("Choose up to 20 CSV or XLSX files, at most 5 MB each and 20 MB in total.")
  }
  const encoded: Array<{ fileName: string; contentBase64: string }> = []
  const fingerprints: ChatImportPointer["files"] = []
  for (const file of args.files) {
    const bytes = await file.arrayBuffer()
    assertCurrent()
    if (bytes.byteLength !== file.size) throw new Error("The selected file changed while being read. Select the original files again.")
    const digest = await crypto.subtle.digest("SHA-256", bytes)
    fingerprints.push({ fileName: file.name, size: file.size, sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") })
    encoded.push({ fileName: file.name, contentBase64: base64(new Uint8Array(bytes)) })
  }
  assertCurrent()
  const previous = readChatImportPointer(args.storage, args.scope)
  if (!previous) {
    const existing = args.knownTasks?.find(task => JSON.stringify(task.files.map(({ fileName, size, sha256 }) => ({ fileName, size, sha256 }))) === JSON.stringify(fingerprints))
    if (existing) {
      const saved = await readChatImportTask(args.fetcher, args.scope, existing.requestId)
      assertCurrent()
      if (!saved) throw new Error("The matching saved import is unavailable. Check saved imports before starting another submission.")
      verifyImportSources(saved, { requestId: existing.requestId, files: fingerprints })
      return saved
    }
  }
  if (previous && JSON.stringify(previous.files) !== JSON.stringify(fingerprints)) throw new Error("Check the previous submission before adding different files. To retry it, select the same original files in the same order.")
  const pointer = pointerSchema.parse({ requestId: previous?.requestId ?? (args.createRequestId?.() ?? crypto.randomUUID().replaceAll("-", "")), files: fingerprints })
  args.storage.setItem(key, JSON.stringify(pointer))
  assertCurrent()
  const body = JSON.stringify({ companyId: args.scope.companyId, requestId: pointer.requestId, conversationKey: args.scope.conversationKey, files: encoded })
  let task: ChatImportTask
  let rejected: string | null = null
  try {
    const response = await args.fetcher("/api/import-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body })
    assertCurrent()
    if (!response.ok) {
      if ([400, 413, 415, 422].includes(response.status)) {
        const body = await response.json().catch(() => null)
        rejected = typeof body?.error === "string" ? body.error : response.status === 413
          ? "These files exceed the upload limit. Choose a smaller set and try again."
          : "The files could not be accepted. Check their format and choose another selection."
      }
      throw new Error("Import preparation did not return a receipt.")
    }
    task = parseChatImportTask(await response.json(), args.scope, pointer.requestId)
  } catch (error) {
    assertCurrent()
    // A missing response is not permission to create a second submission.
    const saved = await readChatImportTask(args.fetcher, args.scope, pointer.requestId)
    assertCurrent()
    if (!saved) {
      // A definitive input rejection plus exact absence establishes that a new selection is safe.
      if (rejected) { args.storage.removeItem(key); throw new Error(rejected) }
      throw new Error("The upload result is uncertain. Check its saved result, or select the same files to retry this submission.", { cause: error })
    }
    task = saved
  }
  assertCurrent()
  verifyImportSources(task, pointer)
  args.storage.removeItem(key)
  return task
}

/** Refresh checks the exact retained request; it never dispatches a POST. */
export async function recoverChatImportPointer(args: {
  scope: ChatImportScope; storage: ReceiptStorage; fetcher: ImportTaskFetch; isCurrent: () => boolean;
}): Promise<{ pointer: ChatImportPointer | null; task: ChatImportTask | null }> {
  if (!args.isCurrent()) throw new Error("The active import company changed.")
  const pointer = readChatImportPointer(args.storage, args.scope)
  if (!pointer) return { pointer: null, task: null }
  const task = await readChatImportTask(args.fetcher, args.scope, pointer.requestId)
  if (!args.isCurrent()) throw new Error("The active import company changed.")
  if (task) {
    verifyImportSources(task, pointer)
    args.storage.removeItem(chatImportScopeKey(args.scope))
    return { pointer: null, task }
  }
  return { pointer, task: null }
}

export function chatImportDecisionStorageKey(scope: ChatImportScope, taskRequestId: string): string {
  return `${chatImportScopeKey(scope)}:decision:${requestId.parse(taskRequestId)}`
}

export function readChatImportDecisionPointer(storage: ReceiptStorage, scope: ChatImportScope, taskRequestId: string): ChatImportDecisionPointer | null {
  const raw = storage.getItem(chatImportDecisionStorageKey(scope, taskRequestId))
  const pointer = raw ? decisionPointerSchema.parse(JSON.parse(raw)) : null
  if (pointer && pointer.taskRequestId !== taskRequestId) throw new Error("The saved decision belongs to another file task.")
  return pointer
}

function verifyDecisionReceipt(task: ChatImportTask, pointer: ChatImportDecisionPointer): void {
  const receipt = task.decisionReceipt
  if (task.requestId !== pointer.taskRequestId || task.decision.id !== pointer.questionId
    || !receipt || receipt.decisionId !== pointer.decisionId || receipt.optionId !== pointer.optionId
    || receipt.otherText !== (pointer.otherText ?? null) || receipt.revision !== pointer.expectedRevision + 1) {
    throw new Error("The saved decision receipt does not match this answer. Keep the original approval identity and check again.")
  }
}

/** Read one exact decision receipt, including an older answer after the question has advanced. */
async function readDecisionReceipt(fetcher: ImportTaskFetch, scope: ChatImportScope, pointer: ChatImportDecisionPointer): Promise<ChatImportTask | null> {
  const response = await fetcher(`/api/import-tasks/${pointer.taskRequestId}?companyId=${scope.companyId}&decisionId=${pointer.decisionId}`, { cache: "no-store" })
  if (response.status === 404) return null
  if (!response.ok) throw new Error("The file decision could not be checked. Its original approval identity is retained.")
  const task = parseChatImportTask(await response.json(), scope, pointer.taskRequestId)
  verifyDecisionReceipt(task, pointer)
  return task
}

async function dispatchDecision(args: {
  pointer: ChatImportDecisionPointer; scope: ChatImportScope; storage: ReceiptStorage; fetcher: ImportTaskFetch; isCurrent: () => boolean;
}): Promise<ChatImportTask> {
  const assertCurrent = () => { if (!args.isCurrent()) throw new Error("The active company or conversation changed. Reopen the saved file decision in its original scope.") }
  assertCurrent()
  let task: ChatImportTask
  let definitiveRejection: string | null = null
  try {
    const response = await args.fetcher(`/api/import-tasks/${args.pointer.taskRequestId}/decision`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: args.scope.companyId, decisionId: args.pointer.decisionId, expectedRevision: args.pointer.expectedRevision,
        optionId: args.pointer.optionId, ...(args.pointer.otherText != null ? { otherText: args.pointer.otherText } : {}) }),
    })
    assertCurrent()
    if (!response.ok) {
      if ([400, 409, 413, 415, 422].includes(response.status)) {
        const body = await response.json().catch(() => null)
        definitiveRejection = typeof body?.error === "string" ? body.error : "The question or answer changed. Check the saved task and review its current question."
      }
      throw new Error("The file decision did not return a verified receipt.")
    }
    task = parseChatImportTask(await response.json(), args.scope, args.pointer.taskRequestId)
    verifyDecisionReceipt(task, args.pointer)
  } catch (error) {
    assertCurrent()
    const saved = await readDecisionReceipt(args.fetcher, args.scope, args.pointer)
    assertCurrent()
    if (!saved) {
      if (definitiveRejection) {
        args.storage.removeItem(chatImportDecisionStorageKey(args.scope, args.pointer.taskRequestId))
        throw new Error(definitiveRejection)
      }
      throw new Error("The decision result is uncertain. Check its saved receipt or retry the same answer; another approval has not been sent.", { cause: error })
    }
    task = saved
  }
  assertCurrent()
  args.storage.removeItem(chatImportDecisionStorageKey(args.scope, args.pointer.taskRequestId))
  return task
}

/** Selection is local; only an explicit card submission creates this immutable approval request. */
export async function submitChatImportDecision(args: {
  task: ChatImportTask; answer: ChatImportDecisionAnswer; scope: ChatImportScope; storage: ReceiptStorage;
  fetcher: ImportTaskFetch; isCurrent: () => boolean; createDecisionId?: () => string;
}): Promise<ChatImportTask> {
  if (!args.isCurrent()) throw new Error("The active company or conversation changed.")
  const task = parseChatImportTask(args.task, args.scope, args.task.requestId)
  if (task.status !== "awaiting_decision" || task.decision.status !== "pending"
    || args.answer.requestId !== task.decision.id || args.answer.expectedRevision !== task.decision.revision
    || (args.answer.optionId !== "other" && !task.decision.options.some(option => option.id === args.answer.optionId))) {
    throw new Error("This file question changed. Check its saved task before answering.")
  }
  const otherText = args.answer.optionId === "other" ? args.answer.otherText?.trim() : undefined
  if (args.answer.optionId === "other" && (!otherText || otherText.length > 2000 || new TextEncoder().encode(otherText).length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(otherText))) {
    throw new Error("Enter instructions of at most 2,000 characters, without unsupported control characters.")
  }
  if (args.answer.optionId !== "other" && args.answer.otherText != null) throw new Error("Custom instructions must be submitted using Other.")
  const existing = readChatImportDecisionPointer(args.storage, args.scope, task.requestId)
  const candidate = decisionPointerSchema.parse({ taskRequestId: task.requestId, questionId: task.decision.id,
    decisionId: existing?.decisionId ?? args.createDecisionId?.() ?? crypto.randomUUID().replaceAll("-", ""),
    expectedRevision: args.answer.expectedRevision, optionId: args.answer.optionId, ...(otherText != null ? { otherText } : {}) })
  if (existing && JSON.stringify(existing) !== JSON.stringify(candidate)) throw new Error("Check the previous decision receipt before changing this answer. Retry the saved answer with its original approval identity.")
  args.storage.setItem(chatImportDecisionStorageKey(args.scope, task.requestId), JSON.stringify(candidate))
  return dispatchDecision({ ...args, pointer: candidate })
}

/** Explicit retry dispatches the frozen answer and approval identity; refresh never does. */
export async function retryChatImportDecision(args: {
  taskRequestId: string; scope: ChatImportScope; storage: ReceiptStorage; fetcher: ImportTaskFetch; isCurrent: () => boolean;
}): Promise<ChatImportTask> {
  const pointer = readChatImportDecisionPointer(args.storage, args.scope, args.taskRequestId)
  if (!pointer) throw new Error("The saved decision could not be found. Check the current question before answering.")
  return dispatchDecision({ ...args, pointer })
}

export async function recoverChatImportDecision(args: {
  task: ChatImportTask; scope: ChatImportScope; storage: ReceiptStorage; fetcher: ImportTaskFetch; isCurrent: () => boolean;
}): Promise<{ task: ChatImportTask; pointer: ChatImportDecisionPointer | null }> {
  if (!args.isCurrent()) throw new Error("The active file decision company changed.")
  const pointer = readChatImportDecisionPointer(args.storage, args.scope, args.task.requestId)
  if (!pointer) return { task: args.task, pointer: null }
  const saved = await readDecisionReceipt(args.fetcher, args.scope, pointer)
  if (!args.isCurrent()) throw new Error("The active file decision company changed.")
  if (!saved) return { task: args.task, pointer }
  args.storage.removeItem(chatImportDecisionStorageKey(args.scope, pointer.taskRequestId))
  return { task: saved, pointer: null }
}
