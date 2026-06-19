/** UI context forwarded to RAG: metadata only; never used for authorization. */
export type RagUiContext = {
  route?: string
  module?: string
  active_view?: string
  active_tab?: string
  entity_type?: string
  entity_id?: string
  selection_summary?: string
  permissions?: string[]
  /** Echo of scoped company (informational; authoritative id is the top-level request field). */
  company_id?: number
  /** Parsed @command names from the user message (e.g. inventory, customers). */
  at_commands?: string[]
}

/** Alias used by query-hooks and the ERP shell. */
export type AiUiContext = RagUiContext

const MAX_FIELD_LEN = 512
const MAX_PERMISSIONS = 64
const SUMMARY_KEYS = ["displayName", "name", "title", "reference", "code", "email", "state", "status"]

function trimField(value: unknown, maxLen = MAX_FIELD_LEN): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed
}

/** Derive ERP route path and module slug from a Next.js pathname (no query string). */
export function deriveErpModuleFromPathname(pathname: string): { route: string; module: string | null } {
  const route = (pathname.split("?")[0] ?? "/").replace(/\/+$/, "") || "/"
  const segment = route.split("/").filter(Boolean)[0] ?? null
  return { route, module: segment }
}

export function buildRagUiContext(args: {
  pathname: string
  activeView?: string | null
  activeTab?: string | null
  companyId?: number | null
  atCommands?: readonly string[]
  permissions?: readonly string[]
  entityType?: string
  entityId?: string
  selectionSummary?: string
}): RagUiContext | undefined {
  const { route, module } = deriveErpModuleFromPathname(args.pathname)
  const ctx: RagUiContext = {}
  if (route) ctx.route = route
  if (module) ctx.module = module

  const activeView =
    trimField(args.activeView ?? undefined, 256) ??
    module ??
    (route.replace(/^\//, "") || "overview")
  ctx.active_view = activeView

  const tab = trimField(args.activeTab ?? undefined, 128)
  if (tab) ctx.active_tab = tab

  if (args.companyId != null && args.companyId > 0) {
    ctx.company_id = Math.floor(args.companyId)
  }

  const entityType = trimField(args.entityType, 128)
  if (entityType) ctx.entity_type = entityType

  const entityId = trimField(args.entityId, 128)
  if (entityId) ctx.entity_id = entityId

  const selectionSummary = trimField(args.selectionSummary)
  if (selectionSummary) ctx.selection_summary = selectionSummary

  if (args.atCommands?.length) {
    const atCommands = args.atCommands
      .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      .map((c) => c.trim().slice(0, 64))
      .slice(0, 10)
    if (atCommands.length) ctx.at_commands = atCommands
  }

  if (args.permissions?.length) {
    const permissions = args.permissions
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .map((p) => p.trim().slice(0, 128))
      .slice(0, MAX_PERMISSIONS)
    if (permissions.length) ctx.permissions = permissions
  }

  return Object.keys(ctx).length > 0 ? ctx : undefined
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number.parseInt(value, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function resolveErpCompanyId(args: {
  organizationId?: number | null
  sessionCompanyIds?: readonly number[] | null
  companyRows?: readonly Record<string, unknown>[] | null
}): number | null {
  void args.organizationId

  const sessionCompanyIds = (args.sessionCompanyIds ?? [])
    .map(numberFromUnknown)
    .filter((id): id is number => id != null && id > 0)

  if (sessionCompanyIds.length > 0) {
    return sessionCompanyIds[0] ?? null
  }

  const rowIds = (args.companyRows ?? [])
    .map((row) => numberFromUnknown(row.id))
    .filter((id): id is number => id != null && id > 0)
  if (rowIds.length > 0) {
    return rowIds[0] ?? null
  }

  return null
}

function collectAllowedCompanyIds(args: {
  sessionCompanyIds?: readonly number[] | null
  companyRows?: readonly Record<string, unknown>[] | null
}): number[] {
  const allowed = new Set<number>()

  for (const id of args.sessionCompanyIds ?? []) {
    const n = numberFromUnknown(id)
    if (n != null && n > 0) allowed.add(n)
  }

  for (const row of args.companyRows ?? []) {
    const n = numberFromUnknown(row.id)
    if (n != null && n > 0) allowed.add(n)
  }

  return [...allowed]
}

/** Prefer user-selected active company when it belongs to the session/org company set. */
export function resolveActiveErpCompanyId(args: {
  activeCompanyId?: number | null
  organizationId?: number | null
  sessionCompanyIds?: readonly number[] | null
  companyRows?: readonly Record<string, unknown>[] | null
}): number | null {
  const allowed = collectAllowedCompanyIds(args)
  const preferred = numberFromUnknown(args.activeCompanyId)
  if (preferred != null && preferred > 0 && allowed.includes(preferred)) {
    return preferred
  }
  return resolveErpCompanyId(args)
}

export function summarizeEntityRow(row: Record<string, unknown>, maxLen = MAX_FIELD_LEN): string {
  const parts: string[] = []
  const id = row.id ?? row.ID
  if (id != null && String(id).trim() !== "") {
    parts.push(`#${String(id).trim()}`)
  }

  for (const key of SUMMARY_KEYS) {
    const value = row[key]
    if (value == null) continue
    const text = String(value).trim()
    if (!text || parts.includes(text)) continue
    parts.push(`${key}: ${text}`)
    if (parts.length >= 4) break
  }

  const summary = parts.length > 0 ? parts.join(", ") : "Selected row"
  return summary.length > maxLen ? summary.slice(0, maxLen) : summary
}

/** Validate and sanitize client-supplied ui_context before forwarding to ai-gateway. */
export function sanitizeRagUiContext(raw: unknown): RagUiContext | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined

  const input = raw as Record<string, unknown>
  const route = trimField(input.route) ?? "/"

  const companyRaw = input.company_id
  const companyId =
    typeof companyRaw === "number" && Number.isFinite(companyRaw) && companyRaw > 0
      ? Math.floor(companyRaw)
      : null

  const atCommands = Array.isArray(input.at_commands)
    ? input.at_commands.filter((c): c is string => typeof c === "string")
    : undefined

  const ctx = buildRagUiContext({
    pathname: route,
    activeView: trimField(input.active_view, 256),
    activeTab: trimField(input.active_tab, 128),
    companyId,
    atCommands,
    entityType: trimField(input.entity_type, 128),
    entityId: trimField(input.entity_id, 128),
    selectionSummary: trimField(input.selection_summary),
    permissions: Array.isArray(input.permissions)
      ? input.permissions.filter((p): p is string => typeof p === "string")
      : undefined,
  })

  if (!ctx) return undefined

  const moduleOverride = trimField(input.module, 128)
  if (moduleOverride) ctx.module = moduleOverride

  return ctx
}
