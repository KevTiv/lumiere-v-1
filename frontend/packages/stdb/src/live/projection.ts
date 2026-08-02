import type { QueryResourceKey } from "../generated/query-registry"
import { RESOURCE_REGISTRY } from "../generated/query-registry"

/** Normalize SDK row objects to plain JSON-safe records (camelCase, numeric ids). */
export function normalizeRow(row: unknown): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(row, (_key, value) => (typeof value === "bigint" ? Number(value) : value)),
  ) as Record<string, unknown>
}

export function rowNotSoftDeleted(row: Record<string, unknown>): boolean {
  const deleted = row.deletedAt ?? row.deleted_at
  if (deleted == null) return true
  if (typeof deleted === "object" && deleted !== null) {
    const tag = (deleted as { tag?: string }).tag
    if (tag === "none" || tag === "None") return true
  }
  return false
}

function rowOrgId(row: Record<string, unknown>): number | null {
  const raw = row.organizationId ?? row.organization_id
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function rowCompanyId(row: Record<string, unknown>): number | null {
  const raw = row.companyId ?? row.company_id
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

const COMPANY_SCOPED_RESOURCES = new Set<QueryResourceKey>([
  "fixed-assets",
  "depreciation-lines",
  "intercompany-rules",
  "intercompany-transactions",
  "pos-configs",
  "pos-sessions",
  "picking-batches",
])

const INTERCOMPANY_RESOURCES = new Set<QueryResourceKey>([
  "intercompany-rules",
  "intercompany-transactions",
])

const CRM_OPTIONAL_COMPANY_RESOURCES = new Set<QueryResourceKey>([
  "contacts",
  "opportunities",
  "contact-phone-identities",
  "contact-role-assignments",
  "contact-communication-preferences",
])

const CRM_REQUIRED_COMPANY_RESOURCES = new Set<QueryResourceKey>([
  "contact-duplicate-candidates",
  "crm-forecast-snapshots",
])

const CRM_PARENT_SCOPED_RESOURCES = new Set<QueryResourceKey>([
  "opportunity-lines",
  "opportunity-presence",
  "contact-tag-assignments",
  "segment-members",
  "contact-relationships",
  "privacy-consent",
  "contact-relationship-insights",
  "crm-conversations",
  "crm-conversation-messages",
])

export interface ResourceScopeContext {
  organizationId: number
  companyIds?: readonly number[]
}

const GLOBAL_RESOURCES = new Set<QueryResourceKey>(["roles"])

export function rowMatchesResourceScope(
  resource: QueryResourceKey,
  row: Record<string, unknown>,
  ctx: ResourceScopeContext,
): boolean {
  if (!rowNotSoftDeleted(row)) return false

  const reg = RESOURCE_REGISTRY[resource]
  if (!reg) return false

  if (GLOBAL_RESOURCES.has(resource)) {
    return true
  }

  const orgId = rowOrgId(row)
  if (orgId != null && orgId !== ctx.organizationId) {
    return false
  }

  const ids = ctx.companyIds ?? []
  if (CRM_OPTIONAL_COMPANY_RESOURCES.has(resource)) {
    if (ids.length !== 1) return false
    const cid = rowCompanyId(row)
    return cid == null || cid === ids[0]
  }

  if (CRM_REQUIRED_COMPANY_RESOURCES.has(resource)) {
    if (ids.length !== 1) return false
    return rowCompanyId(row) === ids[0]
  }

  // Ownership is inherited through a parent row and cannot be proven from this
  // projection alone. These resources are loaded through the authorized HTTP path.
  if (CRM_PARENT_SCOPED_RESOURCES.has(resource)) return false

  if (COMPANY_SCOPED_RESOURCES.has(resource)) {
    if (ids.length === 0) return false

    if (INTERCOMPANY_RESOURCES.has(resource)) {
      const source = Number(row.sourceCompanyId ?? row.source_company_id ?? 0)
      const dest = Number(row.destinationCompanyId ?? row.destination_company_id ?? 0)
      const origin = Number(row.originCompanyId ?? row.origin_company_id ?? 0)
      return ids.some((id) => id === source || id === dest || id === origin)
    }

    const cid = rowCompanyId(row)
    if (cid == null) return false
    return ids.includes(cid)
  }

  if (orgId == null && reg.mandatory.includes("organization_id")) {
    return false
  }

  return true
}

const SOFT_DELETE_FILTER_RESOURCES = new Set<QueryResourceKey>([
  "activities",
  "companies",
  "contacts",
  "leads",
  "product-categories",
])

export function filterRowsForResource(
  resource: QueryResourceKey,
  rows: Record<string, unknown>[],
  ctx: ResourceScopeContext,
): Record<string, unknown>[] {
  let out = rows.filter((r) => rowMatchesResourceScope(resource, r, ctx))
  if (SOFT_DELETE_FILTER_RESOURCES.has(resource)) {
    out = out.filter(rowNotSoftDeleted)
  }
  return sortRowsForResource(resource, out)
}

function compareIdDesc(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const ai = Number(a.id ?? 0)
  const bi = Number(b.id ?? 0)
  return bi - ai
}

/** Client-side sort mirrors `api-server/src/query_exec.rs` post-fetch ordering. */
export function sortRowsForResource(
  resource: QueryResourceKey,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const sorted = [...rows]
  switch (resource) {
    case "contact-tags":
    case "contact-segments":
      sorted.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
      break
    case "opportunity-stages":
      sorted.sort(
        (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0),
      )
      break
    case "activities":
      sorted.sort(compareIdDesc)
      break
    case "account-accounts":
      sorted.sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? "")))
      break
    case "account-account-types":
      sorted.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
      break
    case "account-groups":
      sorted.sort((a, b) => {
        const la = Number(a.level ?? 0)
        const lb = Number(b.level ?? 0)
        if (la !== lb) return la - lb
        return String(a.name ?? "").localeCompare(String(b.name ?? ""))
      })
      break
  }
  return sorted
}
