/** Map RAG / activity source identifiers to in-app ERP routes (metadata only). */

export type AiSourceLinkInput = {
  content_type?: string
  entity_type?: string
  content_id?: number | string
  entity_id?: string | number
}

type ModuleTabTarget = {
  kind: "module_tab"
  module: string
  tab: string
}

type PathPrefixTarget = {
  kind: "path_prefix"
  /** e.g. `/proposals` to `/proposals/42` when an id is present */
  prefix: string
}

type SourceRouteTarget = ModuleTabTarget | PathPrefixTarget

/** Known SearchEmbedding content_type and activity entity_type to module tab routes. */
const SOURCE_ROUTE_MAP: Record<string, SourceRouteTarget> = {
  // Vector search (SearchEmbedding.content_type)
  product: { kind: "module_tab", module: "inventory", tab: "products" },
  contact: { kind: "module_tab", module: "crm", tab: "contacts" },
  document: { kind: "module_tab", module: "documents", tab: "documents" },
  article: { kind: "module_tab", module: "documents", tab: "knowledge-base" },
  knowledge_article: { kind: "module_tab", module: "documents", tab: "knowledge-base" },
  invoice: { kind: "module_tab", module: "accounting", tab: "invoices" },
  bill: { kind: "module_tab", module: "accounting", tab: "bills" },
  proposal: { kind: "path_prefix", prefix: "/proposals" },

  // Activity memory (context_worker entity_type)
  sale_order: { kind: "module_tab", module: "sales", tab: "orders" },
  project_task: { kind: "module_tab", module: "projects", tab: "tasks" },
  project_project: { kind: "module_tab", module: "projects", tab: "projects" },
  hr_leave: { kind: "module_tab", module: "hr", tab: "leaves" },
  iot_telemetry: { kind: "module_tab", module: "iot", tab: "iot-telemetry" },
  account_move: { kind: "module_tab", module: "accounting", tab: "journal-entries" },
  mrp_production: { kind: "module_tab", module: "manufacturing", tab: "orders" },
  purchase_order: { kind: "module_tab", module: "purchasing", tab: "orders" },
}

function normalizeSourceKey(raw?: string): string | undefined {
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return undefined
  return trimmed.replace(/-/g, "_")
}

function sourceRecordId(input: AiSourceLinkInput): string | undefined {
  if (input.entity_id != null && String(input.entity_id).trim() !== "") {
    return String(input.entity_id).trim()
  }
  if (input.content_id != null && String(input.content_id).trim() !== "") {
    return String(input.content_id).trim()
  }
  return undefined
}

/** Build a module tab href consistent with `useModuleTab` (`?tab=` when not dashboard). */
export function buildModuleTabHref(module: string, tab: string, defaultTab = "dashboard"): string {
  const base = `/${module.replace(/^\/+/, "")}`
  if (!tab || tab === defaultTab) return base
  return `${base}?tab=${encodeURIComponent(tab)}`
}

function resolveTarget(target: SourceRouteTarget, recordId?: string): string | undefined {
  if (target.kind === "path_prefix") {
    if (!recordId) return target.prefix
    return `${target.prefix}/${encodeURIComponent(recordId)}`
  }
  return buildModuleTabHref(target.module, target.tab)
}

/**
 * Resolve an in-app href for a RAG or activity citation.
 * Prefers content_type/content_id, then entity_type/entity_id.
 * Returns undefined when the type is unknown (caller keeps plain-text citation).
 */
export function resolveAiSourceHref(input: AiSourceLinkInput): string | undefined {
  const contentKey = normalizeSourceKey(input.content_type)
  const entityKey = normalizeSourceKey(input.entity_type)
  const recordId = sourceRecordId(input)

  const target =
    (contentKey ? SOURCE_ROUTE_MAP[contentKey] : undefined) ??
    (entityKey ? SOURCE_ROUTE_MAP[entityKey] : undefined)

  if (!target) return undefined
  return resolveTarget(target, recordId)
}
