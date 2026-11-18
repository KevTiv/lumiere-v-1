import { stbTimestampMicros } from "@lumiere/erp-shared/stb-timestamp"
import { parseAssistantActionId } from "@lumiere/query-hooks/assistant-actions"
import { parseWorkBoardPage, workStatus, type WorkBoardScope } from "@lumiere/query-hooks/hooks/work-board-model"
import type { ChatMessageSourceRef } from "@lumiere/ui/lib/ai-chat-types"
import { z } from "zod"
import { apiFetch } from "./api-fetch"

type Kind = "calendar_event" | "workflow_human_task" | "document"
const recordResponse = z.object({
  data: z.object({
    id: z.unknown(),
    organizationId: z.unknown(),
    organization_id: z.unknown(),
    companyId: z.unknown(),
    company_id: z.unknown(),
    name: z.unknown(),
    privacy: z.unknown(),
    allday: z.unknown(),
    start: z.unknown(),
    stop: z.unknown(),
    state: z.unknown(),
    location: z.unknown(),
    fileSize: z.unknown(),
    file_size: z.unknown(),
    fileName: z.unknown(),
    file_name: z.unknown(),
    mimetype: z.unknown(),
  }),
})
type Row = z.infer<typeof recordResponse>["data"]

export type AssistantSupportRecordRequest = { kind: Kind; id: string }

type Options = Pick<WorkBoardScope, "organizationId" | "companyId" | "actorIdentity"> & {
  locale?: string
  signal?: AbortSignal
}

const LABELS: Record<Kind, string> = {
  calendar_event: "Calendar event",
  workflow_human_task: "Approval request",
  document: "Document",
}

const READ_REQUESTS = [
  /^(?:show(?: me)?|read|get|tell me)(?: the)?(?: details (?:of|for|about)| about)? /i,
  /^what(?: is| are|['’]s)(?: the)? (?:current status|status|details|name|date|time|file type|size) (?:of|for) /i,
  /^when (?:is|was|does) /i,
]
const SUPPORT_RECORD = /^(?:the )?(calendar event|approval(?: request| task)?|document(?: metadata)?) (?:(?:with )?id )?#? ?([1-9]\d{0,19})(?: (?:start|end))?[.!?]*$/i

/** Match explicit read questions so normal navigation and actions keep their own handlers. */
export function parseAssistantSupportRecord(query: string): AssistantSupportRecordRequest | undefined {
  const normalized = query.trim().replace(/\s+/g, " ")
  const prefix = READ_REQUESTS.find(pattern => pattern.test(normalized))
  if (!prefix) return undefined
  const [, target, rawId] = SUPPORT_RECORD.exec(normalized.replace(prefix, "")) ?? []
  const id = parseAssistantActionId(rawId)
  if (!target || !id) return undefined
  const kind = target.toLowerCase().startsWith("approval")
    ? "workflow_human_task"
    : target.toLowerCase().startsWith("document") ? "document" : "calendar_event"
  return { kind, id }
}

function rowId(value: unknown): string | undefined {
  return parseAssistantActionId(typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value)
}

function field(record: Row, camel: keyof Row, snake = camel): unknown {
  const value = Object.hasOwn(record, camel) ? record[camel] : record[snake]
  if (value && typeof value === "object" && Object.keys(value).length === 1) {
    if ("some" in value && Object.hasOwn(value, "some")) return value.some
    if ("none" in value && Object.hasOwn(value, "none")) return null
  }
  return value
}

function readableText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]+/gu, " ").trim().slice(0, 180)
  return cleaned || undefined
}

function markdown(text: string): string {
  return text.replace(/[\\`*_{}\[\]()<>#+.!|]/g, "\\$&")
}

function eventDate(value: unknown): Date | undefined {
  const micros = typeof value === "string" && /^-?\d+$/.test(value)
    ? BigInt(value)
    : stbTimestampMicros(value)
  if (micros == null) return undefined
  const date = new Date(Number(micros / 1000n))
  return Number.isFinite(date.getTime()) ? date : undefined
}

function calendarDetails(record: Row, locale?: string): [string, string | undefined][] {
  const allDay = field(record, "allday") === true
  const start = eventDate(field(record, "start"))
  const stop = eventDate(field(record, "stop"))
  const format = new Intl.DateTimeFormat(locale, allDay
    ? { dateStyle: "medium", timeZone: "UTC" }
    : { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })
  const lastDay = allDay && start && stop && stop > start ? new Date(stop.getTime() - 1) : stop
  return [
    ["Status", readableText(field(record, "state"))],
    [allDay ? "First day (UTC)" : "Starts (UTC)", start && format.format(start)],
    [allDay ? "Last day (UTC)" : "Ends (UTC)", lastDay && format.format(lastDay)],
    ["Location", readableText(field(record, "location"))],
  ]
}

function documentDetails(record: Row, locale?: string): [string, string | undefined][] {
  const rawSize = field(record, "fileSize", "file_size")
  const size = typeof rawSize === "number" && Number.isSafeInteger(rawSize) && rawSize >= 0
    ? BigInt(rawSize)
    : typeof rawSize === "string" && /^\d{1,20}$/.test(rawSize) ? BigInt(rawSize) : undefined
  return [
    ["File name", readableText(field(record, "fileName", "file_name"))],
    ["File type", readableText(field(record, "mimetype"))],
    ["Size", size === undefined ? undefined : `${new Intl.NumberFormat(locale).format(size)} bytes`],
  ]
}

/** Fetch exactly one record using the owning workspace's session and read policy. */
export async function readAssistantSupportRecord(
  request: AssistantSupportRecordRequest,
  options: Options,
  fetcher: typeof apiFetch = apiFetch,
): Promise<{ content: string; sources: ChatMessageSourceRef[] }> {
  const { kind, id } = request
  const { organizationId, companyId, actorIdentity, signal, locale } = options
  const label = LABELS[kind]
  const unavailable = { content: `That ${label.toLowerCase()} could not be read in this workspace.`, sources: [] }
  if (parseAssistantActionId(id) !== id
    || !Number.isSafeInteger(organizationId) || organizationId <= 0
    || !Number.isSafeInteger(companyId) || companyId <= 0
    || !actorIdentity.trim() || actorIdentity === "unknown") return unavailable

  const approval = kind === "workflow_human_task"
  const scope = { organizationId, companyId, actorIdentity, authorizationKey: "assistant-support-record", scope: "finance", view: "eligible" } as const
  const query = new URLSearchParams({ companyId: String(companyId) })
  const resource = kind === "calendar_event" ? "calendar-events" : "documents"
  if (approval) {
    query.set("workScope", scope.scope)
    query.set("workView", scope.view)
    query.set("limit", "1")
    query.set("taskId", id)
  }
  const path = approval ? "/api/query/workflow-human-tasks" : `/api/authoritative/${resource}/${id}`

  try {
    signal?.throwIfAborted()
    const response = await fetcher(`${path}?${query}`, { cache: "no-store", signal })
    if (!response.ok) return unavailable
    const payload: unknown = await response.json()
    signal?.throwIfAborted()
    let name: string | undefined
    let details: [string, string | undefined][]
    let href: string
    if (approval) {
      const page = parseWorkBoardPage(payload, scope)
      const task = page.data[0]
      if (page.data.length !== 1 || page.nextCursor !== null || !task || rowId(task.id) !== id) return unavailable
      name = readableText(task.workSourceTitle)
      details = [["Status", workStatus(task) ?? undefined], ["Module", task.workModule]]
      href = `/approvals?taskId=${id}&taskCompany=${companyId}`
    } else {
      const parsedRecord = recordResponse.safeParse(payload)
      const record = parsedRecord.success ? parsedRecord.data.data : undefined
      if (!record || rowId(record.id) !== id
        || String(field(record, "organizationId", "organization_id")) !== String(organizationId)) return unavailable
      if (kind === "calendar_event" && field(record, "privacy") !== "public") return unavailable
      if (kind === "document") {
        const company = field(record, "companyId", "company_id")
        if (company !== null && String(company) !== String(companyId)) return unavailable
      }
      name = readableText(field(record, "name"))
      details = kind === "calendar_event" ? calendarDetails(record, locale) : documentDetails(record, locale)
      href = kind === "calendar_event" ? `/calendar/events/${id}` : `/documents/${id}`
    }
    const lines = details.flatMap(([key, value]) => value ? [`- ${key}: ${markdown(value)}`] : [])
    if (!name && lines.length === 0) return unavailable
    const title = `${label} #${id}${name ? ` · ${name}` : ""}`
    return {
      content: [`**${markdown(title)}**`, "", ...lines].join("\n").trim(),
      sources: [{
        kind: "live", trust: "authoritative", instruction_trust: "untrusted", entity_type: kind, entity_id: id,
        label: title, href,
      }],
    }
  } catch {
    signal?.throwIfAborted()
    return unavailable
  }
}
