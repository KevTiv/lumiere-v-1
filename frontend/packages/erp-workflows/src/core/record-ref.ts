import { resolveErpResourceTarget } from "@lumiere/erp-shared/ai-source-links"

/**
 * Stable reference to an ERP record: canonical table name + id, never a label.
 * Route generation stays UI-owned; this only says which module surface owns the record.
 */
export interface ErpRecordRef {
  /** Canonical table name, e.g. `sale_order`, `stock_picking`. */
  resource: string
  id: string
  /** Owning module id, e.g. `sales`, `inventory`. */
  module: string
  /** Module whose workflow produced this ref; enables that module's own view as a fallback. */
  context?: string
}

/** Where the UI should land for a record: the owning module tab, filtered to the record. */
export interface ErpRecordLocation {
  module: string
  tab: string
  filter: Record<string, string>
}

/**
 * Module views that list another module's record, keyed by resource. They are only offered when
 * the ref's `context` names the module, and only after the owning surface (e.g. a Sales user
 * without Inventory access can still open the delivery from Sales fulfillment).
 */
const CONTEXTUAL_SURFACES: Record<string, ReadonlyArray<{ module: string; tab: string }>> = {
  stock_picking: [{ module: "sales", tab: "fulfillment" }],
}

export function recordRef(
  resource: string,
  id: string | number | bigint,
  module?: string,
  context?: string,
): ErpRecordRef {
  const target = resolveErpResourceTarget(resource)
  return { resource, id: String(id), module: module ?? target?.module ?? "", ...(context ? { context } : {}) }
}

export interface ResolveLocationOptions {
  /** Whether the current user may open the module. Omit to skip access filtering. */
  canAccess?(module: string): boolean
}

/**
 * The first surface for the record the user can open: the owning module tab, then the ref's
 * context module. Undefined when there is none (caller keeps plain text / skips navigation).
 */
export function resolveRecordLocation(
  ref: ErpRecordRef,
  options: ResolveLocationOptions = {},
): ErpRecordLocation | undefined {
  if (ref.id === "") return undefined
  const owner = resolveErpResourceTarget(ref.resource)
  const candidates = [
    ...(owner ? [owner] : []),
    ...(ref.context ? (CONTEXTUAL_SURFACES[ref.resource] ?? []).filter((c) => c.module === ref.context) : []),
  ]
  const target = candidates.find((c) => options.canAccess?.(c.module) ?? true)
  return target ? { module: target.module, tab: target.tab, filter: { id: ref.id } } : undefined
}
