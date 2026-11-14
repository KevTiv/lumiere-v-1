/** Map RAG / activity source identifiers to in-app ERP routes (metadata only). */

import { fleetVehicleHref, moduleTabHref, reportWorkspaceHref } from "./record-links"
import { parseStrictU64, type ScalarId } from "./u64"

export type AiSourceLinkInput = {
  entity_type?: string
  entity_id?: ScalarId
  source_kind?: string
  source_key?: string
}

type ModuleTabTarget = {
  kind: "module_tab"
  module: string
  tab: string
  /** Bounded Alpha projection; the resource's workflow owner stays unchanged. */
  navigationModule?: string
  /** Existing dedicated record page, where the module list is not a record view. */
  recordPrefix?: string
  /** Existing native result view with its own record-selection contract. */
  recordHref?: (recordId: string) => string
  /** Exact-record list when the normal destination is a custom, unfiltered view. */
  recordTab?: string
}

type PathPrefixTarget = {
  kind: "path_prefix"
  /** e.g. `/proposals` to `/proposals/42` when an id is present */
  prefix: string
}

type SourceRouteTarget = ModuleTabTarget | PathPrefixTarget

/** Known persisted source kinds and live entity types mapped to ERP routes. */
const SOURCE_ROUTE_MAP: Record<string, SourceRouteTarget> = {
  // Persisted evidence source kinds.
  product: { kind: "module_tab", module: "inventory", navigationModule: "products", tab: "products" },
  product_category: { kind: "module_tab", module: "inventory", navigationModule: "products", tab: "product-categories" },
  contact: { kind: "module_tab", module: "crm", tab: "contacts" },
  lead: { kind: "module_tab", module: "crm", tab: "leads" },
  opportunity: { kind: "module_tab", module: "crm", tab: "opportunities" },
  document: { kind: "module_tab", module: "documents", tab: "documents", recordPrefix: "/documents" },
  article: { kind: "module_tab", module: "documents", tab: "knowledge-base" },
  knowledge_article: { kind: "module_tab", module: "documents", tab: "knowledge-base" },
  // The invoice/bill custom lists do not apply id filters; the ledger does.
  invoice: { kind: "module_tab", module: "accounting", tab: "invoices", recordTab: "journal-entries" },
  bill: { kind: "module_tab", module: "accounting", tab: "bills", recordTab: "journal-entries" },
  proposal: { kind: "path_prefix", prefix: "/proposals" },

  // Activity memory (context_worker entity_type)
  sale_order: { kind: "module_tab", module: "sales", tab: "orders" },
  return_order: { kind: "module_tab", module: "sales", tab: "returns" },
  project_task: { kind: "module_tab", module: "projects", tab: "tasks" },
  project_project: { kind: "module_tab", module: "projects", tab: "projects" },
  hr_leave: { kind: "module_tab", module: "hr", tab: "leaves" },
  iot_telemetry: { kind: "module_tab", module: "iot", tab: "iot-telemetry" },
  account_move: { kind: "module_tab", module: "accounting", tab: "journal-entries" },
  account_payment: { kind: "module_tab", module: "accounting", tab: "payments" },
  hr_expense: { kind: "module_tab", module: "expenses", tab: "expenses" },
  expense: { kind: "module_tab", module: "expenses", tab: "expenses" },
  hr_expense_sheet: { kind: "module_tab", module: "expenses", tab: "expense-sheets", recordPrefix: "/expenses/reports" },
  financial_report: { kind: "module_tab", module: "reports", tab: "reports", recordHref: (id) => reportWorkspaceHref("", id) },
  subscription: { kind: "module_tab", module: "subscriptions", tab: "subscriptions", recordPrefix: "/subscriptions" },
  fleet_vehicle: { kind: "module_tab", module: "fleet", tab: "fleet-vehicles", recordHref: fleetVehicleHref },
  calendar_event: { kind: "module_tab", module: "calendar", tab: "calendar", recordPrefix: "/calendar/events" },
  mrp_production: { kind: "module_tab", module: "manufacturing", tab: "orders" },
  purchase_order: { kind: "module_tab", module: "purchasing", tab: "orders" },
  purchase_requisition: { kind: "module_tab", module: "purchasing", tab: "requisitions" },
  stock_picking: { kind: "module_tab", module: "inventory", tab: "transfers" },
  stock_quant: { kind: "module_tab", module: "inventory", navigationModule: "warehouse", tab: "stock" },
  stock_production_serial: { kind: "module_tab", module: "inventory", navigationModule: "warehouse", tab: "serials" },
  stock_production_lot: { kind: "module_tab", module: "inventory", navigationModule: "warehouse", tab: "lots" },
  stock_move: { kind: "module_tab", module: "inventory", navigationModule: "warehouse", tab: "stock-moves" },
  stock_location: { kind: "module_tab", module: "inventory", navigationModule: "warehouse", tab: "locations" },
  warehouse: { kind: "module_tab", module: "inventory", navigationModule: "warehouse", tab: "warehouses" },
  inventory_adjustment: { kind: "module_tab", module: "inventory", navigationModule: "warehouse", tab: "adjustments" },
  stock_cycle_count: { kind: "module_tab", module: "inventory", navigationModule: "warehouse", tab: "cycle-counts" },
  replenishment_rule: { kind: "module_tab", module: "inventory", navigationModule: "warehouse", tab: "replenishment" },
}

function normalizeSourceKey(raw?: string): string | undefined {
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return undefined
  return trimmed.replace(/-/g, "_")
}

function sourceTarget(key?: string): SourceRouteTarget | undefined {
  return key && Object.hasOwn(SOURCE_ROUTE_MAP, key) ? SOURCE_ROUTE_MAP[key] : undefined
}

function sourceRecordId(input: AiSourceLinkInput): { supplied: boolean; id?: string } {
  const separator = input.source_key?.indexOf(":") ?? -1
  const value = input.entity_id ?? (separator >= 0 ? input.source_key?.slice(separator + 1) : undefined)
  if (value == null) return { supplied: false }
  // Route identities are decimal scalars, not formatted form input or rounded JS numbers.
  if (typeof value === "string" && !/^\d+$/.test(value)) return { supplied: true }
  const id = parseStrictU64(value)
  return { supplied: true, id: id != null && id > 0n ? id.toString() : undefined }
}

/** Build a module tab href consistent with `useModuleTab` (`?tab=` when not dashboard). */
export function buildModuleTabHref(module: string, tab: string, defaultTab = "dashboard"): string {
  return moduleTabHref(module, tab, undefined, defaultTab)
}

function resolveTarget(target: SourceRouteTarget, recordId?: string): string | undefined {
  if (target.kind === "path_prefix") {
    if (!recordId) return target.prefix
    return `${target.prefix}/${encodeURIComponent(recordId)}`
  }
  if (recordId && target.recordHref) return target.recordHref(recordId)
  if (recordId && target.recordPrefix) return `${target.recordPrefix}/${recordId}`
  return moduleTabHref(
    target.navigationModule ?? target.module,
    recordId ? target.recordTab ?? target.tab : target.tab,
    recordId ? { id: recordId } : undefined,
  )
}

/** Owning module tab for a canonical table name; undefined for path-prefixed or unknown resources. */
export function resolveErpResourceTarget(resource: string): { module: string; tab: string } | undefined {
  const key = normalizeSourceKey(resource)
  const target = sourceTarget(key)
  return target?.kind === "module_tab" ? { module: target.module, tab: target.tab } : undefined
}

/**
 * Resolve an in-app href for a RAG or activity citation.
 * Resolves canonical source/source-key or entity identity.
 * Returns undefined when the type is unknown (caller keeps plain-text citation).
 */
export function resolveAiSourceHref(input: AiSourceLinkInput): string | undefined {
  const sourceKind = normalizeSourceKey(input.source_kind)
  const entityKey = normalizeSourceKey(input.entity_type)
  const record = sourceRecordId(input)
  if (record.supplied && !record.id) return undefined

  const target =
    sourceTarget(sourceKind) ?? sourceTarget(entityKey)

  if (!target) return undefined
  return resolveTarget(target, record.id)
}
