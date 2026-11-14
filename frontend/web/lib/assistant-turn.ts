import type { GuideReference } from "@lumiere/ui/lib/assistant-guide-types"
import { guideId, guideRevision } from "./assistant-guides"
import type { AiRagSource } from "@lumiere/query-hooks/hooks/ai-memory"
import { HttpResponseError, httpResponseError } from "@lumiere/api-client/response-error"
import { parseAssistantUiProposals, type AssistantUiProposal } from "./assistant-native-actions"
import { parseImportTaskStatuses } from "./import-task-status"
import type { ChatImportTaskStatus } from "@lumiere/ui/lib/import-task-status"

export type TurnFailure = "denied" | "unavailable" | "failed" | "outcome_unknown"
type SetupFailure = {
  code: "ai_default_agent_not_provisioned" | "ai_surface_skill_not_provisioned" | "ai_retrieval_unavailable" | "ai_generation_source_unavailable" | "ai_skill_unavailable"
  message: string
  recoveryPath?: "/ai-skills"
}
export type AssistantTurnFailure = { kind: TurnFailure; setup?: SetupFailure; retryMessage?: string }
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
  if (code !== "ai_default_agent_not_provisioned" && code !== "ai_surface_skill_not_provisioned" && code !== "ai_retrieval_unavailable" && code !== "ai_generation_source_unavailable" && code !== "ai_skill_unavailable") return undefined

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

/** Deliver admitted text provisionally. Only a complete stream returns answer metadata. */
export async function readAssistantStream<T>(
  response: Response,
  parseMetadata: (raw: string) => T,
  onDelta?: (text: string) => void,
): Promise<T & { answer: string }> {
  if (!response.ok) throw await httpResponseError(response, "Assistant stream rejected")
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new Error("Assistant stream is unavailable")
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let receivedBytes = 0
  let buffer = ""
  let answer = ""
  let metadata: T | undefined
  let completed = false
  const event = (raw: string) => {
    if (raw.length > MAX_ASSISTANT_EVENT_LENGTH) throw new Error("Assistant stream event exceeds its size limit")
    const lines = raw.split(/\r?\n/)
    const name = lines.find(line => line.startsWith("event:"))?.slice(6).trim()
    const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n")
    if (completed && name) throw new Error("Assistant stream continued after completion")
    if (name === "delta") {
      if (answer.length + data.length > MAX_ASSISTANT_ANSWER_LENGTH) throw new Error("Assistant answer exceeds its size limit")
      answer += data
    } else if (name === "sources") metadata = parseMetadata(data)
    else if (name === "error") throw new Error("Assistant stream failed")
    else if (name === "done") {
      if (!metadata || !answer.trim()) throw new Error("Assistant stream is incomplete")
      completed = true
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      receivedBytes += value?.byteLength ?? 0
      if (receivedBytes > MAX_ASSISTANT_STREAM_BYTES) throw new Error("Assistant stream exceeds its size limit")
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const parts = buffer.split(/\r?\n\r?\n/)
      buffer = parts.pop() ?? ""
      if (buffer.length > MAX_ASSISTANT_EVENT_LENGTH) throw new Error("Assistant stream event exceeds its size limit")
      const priorLength = answer.length
      for (const part of parts) event(part)
      if (answer.length > priorLength) onDelta?.(answer.slice(priorLength))
      if (done) break
    }
    if (buffer.trim()) event(buffer)
    if (!completed || !metadata) throw new Error("Assistant stream ended before completion")
    return { ...metadata, answer }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** Fail closed before joining an answer to independently prepared draft cards. */
export function assistantAnswerMetadata(value: unknown): { sources: AiRagSource[]; model?: string; run_id?: number; guides?: GuideReference[]; ui_actions?: AssistantUiProposal[]; importTasks?: ChatImportTaskStatus[]; earlierContextUnavailable?: boolean } {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid assistant metadata")
  const raw = value as { sources?: unknown; model?: unknown; run_id?: unknown; related_guides?: unknown; ui_actions?: unknown; import_task_statuses?: unknown; earlier_context_unavailable?: unknown }
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
  return { sources: raw.sources as AiRagSource[], guides, model: typeof raw.model === "string" ? raw.model : undefined, run_id: typeof raw.run_id === "number" ? raw.run_id : undefined,
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
