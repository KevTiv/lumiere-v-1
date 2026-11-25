import type { GuideReference } from "@lumiere/ui/lib/assistant-guide-types"
import { guideId, guideRevision } from "./assistant-guides"
import type { AiRagSource } from "@lumiere/query-hooks/hooks/ai-memory"
import { HttpResponseError, httpResponseError } from "@lumiere/api-client/response-error"
import { parseAssistantUiProposals, type AssistantUiProposal } from "./assistant-native-actions"
import { parseImportTaskStatuses } from "./import-task-status"
import type { ChatImportTaskStatus } from "@lumiere/ui/lib/import-task-status"
import { isRunnerEvidenceId, type RunnerVerifiedReply } from "./local-runner-state"

export type TurnFailure = "denied" | "unavailable" | "failed" | "outcome_unknown"
type SetupFailure = {
  code:
    | "ai_default_agent_not_provisioned"
    | "ai_surface_skill_not_provisioned"
    | "ai_retrieval_unavailable"
    | "ai_generation_source_unavailable"
    | "ai_generation_admission_unavailable"
    | "ai_skill_unavailable"
  message: string
  recoveryPath?: "/ai-skills"
}
export type AssistantTurnFailure = { kind: TurnFailure; setup?: SetupFailure; retryMessage?: string }
export type AssistantVerification = {
  outcome: "admitted" | "qualified" | "requires_review" | "blocked"
  methods: string[]
  limitations: string[]
  reason?: string | null
  evidenceId?: string
}
type TurnAttempt<T> = { kind: "ready"; value: T } | AssistantTurnFailure
export type AssistantTurn<A, D> = {
  answer: TurnAttempt<A>
  drafts: TurnAttempt<D[]> | { kind: "not_requested" }
}

export function turnFailure(error: unknown): TurnFailure {
  if (error instanceof HttpResponseError) {
    if (error.status === 408) return "outcome_unknown"
    if (error.status === 401 || error.status === 403) return "denied"
    if ([404, 429, 503].includes(error.status)) return "unavailable"
    if (error.status >= 400 && error.status < 500) return "failed"
  }
  // An interrupted reply cannot establish that the provider or draft write failed.
  return "outcome_unknown"
}

export function assistantSetupFailure(error: unknown): SetupFailure | undefined {
  if (!(error instanceof HttpResponseError) || error.status !== 503) return undefined

  const { code, message, recoveryPath } = error
  if (
    code !== "ai_default_agent_not_provisioned" &&
    code !== "ai_surface_skill_not_provisioned" &&
    code !== "ai_retrieval_unavailable" &&
    code !== "ai_generation_source_unavailable" &&
    code !== "ai_generation_admission_unavailable" &&
    code !== "ai_skill_unavailable"
  ) return undefined

  return { code, message, recoveryPath: aiSkillsRecoveryPath(recoveryPath) }
}

function aiSkillsRecoveryPath(value: unknown): "/ai-skills" | undefined {
  return value === "/ai-skills" ? value : undefined
}

export function parseStoredAssistantRecovery(raw: string | null | undefined) {
  if (!raw) return undefined
  try {
    return aiSkillsRecoveryPath(JSON.parse(raw)?.assistantRecoveryPath)
  } catch {
    return undefined
  }
}

export function withAssistantRecoveryMetadata(
  raw: string | null,
  recoveryPath: SetupFailure["recoveryPath"],
): string | null {
  return recoveryPath
    ? JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), assistantRecoveryPath: recoveryPath })
    : raw
}

/** Presentation coordination only. Existing server routes own all admission and effects.
 * Each callback runs once; neither partial failure nor a lost reply causes redispatch.
 */
export async function coordinateAssistantTurn<A, D>(args: {
  answer: () => Promise<A>
  drafts?: () => Promise<D[]>
  isCurrent: () => boolean
}): Promise<AssistantTurn<A, D> | { kind: "scope_changed" }> {
  if (!args.isCurrent()) return { kind: "scope_changed" }
  const attempt = async <T>(run: () => Promise<T>): Promise<TurnAttempt<T>> => {
    try { return { kind: "ready", value: await run() } }
    catch (error) {
      const setup = assistantSetupFailure(error)
      const retryMessage = error instanceof HttpResponseError
        ? error.code === "ai_chat_input_too_large"
          ? "Shorten your message before sending. You can attach a file separately."
          : error.status === 429 ? "The assistant is busy. Try again in a moment." : undefined
        : undefined
      return { kind: turnFailure(error), ...(setup && { setup }), ...(retryMessage && { retryMessage }) }
    }
  }
  const [answer, drafts] = await Promise.all([
    attempt(args.answer),
    args.drafts ? attempt(args.drafts) : Promise.resolve({ kind: "not_requested" } as const),
  ])
  if (!args.isCurrent()) return { kind: "scope_changed" }
  return { answer, drafts }
}

const MAX_ASSISTANT_STREAM_BYTES = 4 * 1024 * 1024
const MAX_ASSISTANT_EVENT_LENGTH = 1024 * 1024
const MAX_ASSISTANT_ANSWER_LENGTH = 256 * 1024

export function assistantRagPath(explicitRecord: boolean) {
  return explicitRecord ? "/api/ai/rag" : "/api/ai/rag/stream"
}

class AssistantStreamError extends Error {
  constructor(
    readonly reason: "content_type" | "event_size" | "answer_size" | "stream_size"
      | "metadata" | "upstream_error" | "incomplete" | "unexpected_event",
    message: string,
  ) {
    super(message)
  }
}

function assistantRequestId(response: Response) {
  const requestId = response.headers.get("x-lumiere-ai-request-id")
  return requestId && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)
    ? requestId
    : undefined
}

export async function readAssistantReply(
  response: Response,
  transport: "json" | "sse",
  onDelta: (text: string) => void,
) {
  const diagnostics = { requestId: assistantRequestId(response), status: response.status, transport }
  try {
    if (!response.ok) throw await httpResponseError(response, "Assistant request rejected")
    const reply = transport === "sse"
      ? await readAssistantStream(response, (data) => assistantAnswerMetadata(JSON.parse(data)), onDelta)
      : assistantAnswer(await response.json())
    console.info("[ai.chat] reply_confirmed", {
      ...diagnostics, runId: reply.run_id, sourceCount: reply.sources.length, verification: reply.verification?.outcome,
    })
    return reply
  } catch (error) {
    const reason = error instanceof AssistantStreamError ? error.reason
      : error instanceof HttpResponseError ? "http_error"
      : error instanceof TypeError ? "read_error"
      : "invalid_reply"
    console.warn("[ai.chat] reply_rejected", { ...diagnostics, reason })
    throw error
  }
}

/** Deliver admitted text provisionally. Only a complete stream returns answer metadata. */
export async function readAssistantStream<T>(
  response: Response,
  parseMetadata: (raw: string) => T,
  onDelta?: (text: string) => void,
): Promise<T & { answer: string }> {
  if (!response.ok) throw await httpResponseError(response, "Assistant stream rejected")
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new AssistantStreamError("content_type", "Assistant stream is unavailable")
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let receivedBytes = 0
  let buffer = ""
  let answer = ""
  let metadata: T | undefined
  let completed = false
  const event = (raw: string) => {
    if (raw.length > MAX_ASSISTANT_EVENT_LENGTH) throw new AssistantStreamError("event_size", "Assistant stream event exceeds its size limit")
    const lines = raw.split(/\r?\n/)
    const name = lines.find(line => line.startsWith("event:"))?.slice(6).trim()
    const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n")
    if (completed && name) throw new AssistantStreamError("unexpected_event", "Assistant stream continued after completion")
    if (name === "delta") {
      if (answer.length + data.length > MAX_ASSISTANT_ANSWER_LENGTH) throw new AssistantStreamError("answer_size", "Assistant answer exceeds its size limit")
      answer += data
    } else if (name === "sources") {
      try {
        metadata = parseMetadata(data)
      } catch {
        throw new AssistantStreamError("metadata", "Assistant source metadata is invalid")
      }
    } else if (name === "error") throw new AssistantStreamError("upstream_error", "Assistant stream failed")
    else if (name === "done") {
      if (!metadata || !answer.trim()) throw new AssistantStreamError("incomplete", "Assistant stream is incomplete")
      completed = true
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      receivedBytes += value?.byteLength ?? 0
      if (receivedBytes > MAX_ASSISTANT_STREAM_BYTES) throw new AssistantStreamError("stream_size", "Assistant stream exceeds its size limit")
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const parts = buffer.split(/\r?\n\r?\n/)
      buffer = parts.pop() ?? ""
      if (buffer.length > MAX_ASSISTANT_EVENT_LENGTH) throw new AssistantStreamError("event_size", "Assistant stream event exceeds its size limit")
      const priorLength = answer.length
      for (const part of parts) event(part)
      if (answer.length > priorLength) onDelta?.(answer.slice(priorLength))
      // The gateway emits done only after verification. A late connection
      // error must not invalidate a reply whose terminal event already arrived.
      if (completed || done) break
    }
    if (buffer.trim()) event(buffer)
    if (!completed || !metadata) throw new AssistantStreamError("incomplete", "Assistant stream ended before completion")
    return { ...metadata, answer }
  } finally {
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function assistantVerification(value: unknown): AssistantVerification | undefined {
  if (value == null) return undefined
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid assistant verification")
  const raw = value as Partial<AssistantVerification>
  const limitations = raw.limitations === undefined ? [] : raw.limitations
  if (!["admitted", "qualified", "requires_review", "blocked"].includes(raw.outcome ?? "")
    || !Array.isArray(raw.methods) || raw.methods.some(method => typeof method !== "string")
    || !Array.isArray(limitations) || limitations.some(limit => typeof limit !== "string")
    || (raw.reason != null && typeof raw.reason !== "string")
    || (raw.evidenceId !== undefined && !isRunnerEvidenceId(raw.evidenceId))) throw new Error("Invalid assistant verification")
  return {
    outcome: raw.outcome as AssistantVerification["outcome"], methods: raw.methods, limitations, reason: raw.reason,
    ...(raw.evidenceId && { evidenceId: raw.evidenceId }),
  }
}

/** Persist the verdict rather than treating a successful transport as an admitted answer.
 * This browser-authored history metadata is not independent evidence or review authority.
 */
export function assistantHistoryResult(verification: AssistantVerification | undefined, metadata: string | null) {
  const withheld = verification?.outcome === "blocked" || verification?.outcome === "requires_review"
  return {
    status: withheld ? "failed" : "completed",
    metadata: verification
      ? JSON.stringify({ ...(metadata ? JSON.parse(metadata) : {}), answerVerification: verification })
      : metadata,
  }
}

/** Fail closed before joining an answer to independently prepared draft cards. */
export function assistantAnswerMetadata(value: unknown): { sources: AiRagSource[]; model?: string; run_id?: number; guides?: GuideReference[]; ui_actions?: AssistantUiProposal[]; importTasks?: ChatImportTaskStatus[]; earlierContextUnavailable?: boolean; verification?: AssistantVerification } {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid assistant metadata")
  const raw = value as { sources?: unknown; model?: unknown; run_id?: unknown; related_guides?: unknown; ui_actions?: unknown; import_task_statuses?: unknown; earlier_context_unavailable?: unknown; verification?: unknown }
  if (!Array.isArray(raw.sources)) throw new Error("Invalid assistant sources")
  for (const item of raw.sources) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid assistant source")
    const source = item as AiRagSource
    if (!["live", "passage", "activity", "web"].includes(source.kind)
      || !["authoritative", "persisted", "retrieved"].includes(source.trust)
      || typeof source.text_snippet !== "string") throw new Error("Invalid assistant source")
    if (source.instruction_trust != null && source.instruction_trust !== "untrusted") {
      throw new Error("Invalid assistant source instruction trust")
    }
    for (const key of ["entity_type", "entity_id", "source_kind", "source_key", "source_version", "passage_key", "content_hash", "label", "field", "snapshot_at", "url", "fetched_at"] as const) {
      if (source[key] != null && typeof source[key] !== "string") throw new Error("Invalid assistant source field")
    }
    if (source.from_anchor != null && typeof source.from_anchor !== "boolean") throw new Error("Invalid assistant source anchor flag")
    if (source.score != null && (typeof source.score !== "number" || !Number.isFinite(source.score))) throw new Error("Invalid source score")
    if (source.passage_id != null && (!Number.isSafeInteger(source.passage_id) || source.passage_id <= 0)) throw new Error("Invalid passage identity")
  }
  if (raw.model != null && typeof raw.model !== "string") throw new Error("Invalid assistant model")
  if (raw.run_id != null && (typeof raw.run_id !== "number" || !Number.isSafeInteger(raw.run_id) || raw.run_id <= 0)) throw new Error("Invalid assistant run")
  let guides: GuideReference[] | undefined
  if (raw.related_guides != null) {
    if (!Array.isArray(raw.related_guides) || raw.related_guides.length > 10) throw new Error("Invalid assistant guides")
    guides = raw.related_guides.map((item: unknown) => {
      if (item == null || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid assistant guide")
      const ref = item as { guideId?: unknown; revision?: unknown; title?: unknown; module?: unknown }
      const id = guideId(ref.guideId), revision = guideRevision(ref.revision)
      if (!id || revision == null || (ref.title != null && typeof ref.title !== "string") || (ref.module != null && typeof ref.module !== "string")) throw new Error("Invalid assistant guide reference")
      return { guideId: id, revision, title: typeof ref.title === "string" ? ref.title : undefined, module: typeof ref.module === "string" ? ref.module : undefined }
    })
  }
  const verification = assistantVerification(raw.verification)
  return { sources: raw.sources as AiRagSource[], guides, model: typeof raw.model === "string" ? raw.model : undefined, run_id: typeof raw.run_id === "number" ? raw.run_id : undefined,
    ...(verification ? { verification } : {}),
    ...(raw.earlier_context_unavailable === true ? { earlierContextUnavailable: true } : {}),
    ...(raw.ui_actions !== undefined ? { ui_actions: parseAssistantUiProposals(raw.ui_actions) } : {}),
    ...(raw.import_task_statuses !== undefined ? { importTasks: parseImportTaskStatuses(raw.import_task_statuses) } : {}),
  }
}

export function assistantAnswer(value: unknown) {
  const metadata = assistantAnswerMetadata(value)
  const raw = value as { answer?: unknown }
  if (typeof raw.answer !== "string" || !raw.answer.trim()) throw new Error("Invalid assistant answer")
  return { ...metadata, answer: raw.answer }
}

export function localRunnerAnswer(reply: RunnerVerifiedReply) {
  const answer = assistantAnswer({
    answer: reply.answer,
    sources: reply.sources ?? [],
    run_id: reply.run_id,
    verification: {
      outcome: "admitted",
      methods: ["runner_evidence"],
      limitations: [],
      evidenceId: reply.evidence_id,
    },
  })
  if (answer.sources.some(source => source.url && !/^https?:\/\//i.test(source.url))) {
    throw new Error("A local runner source could not be verified.")
  }
  return answer
}
