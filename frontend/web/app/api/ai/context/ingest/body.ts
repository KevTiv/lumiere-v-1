export const ACTIVITY_INDEX_KINDS = [
  'sale_order', 'purchase_order', 'project_task', 'account_move',
  'mrp_production', 'product', 'contact',
] as const
type ActivityIndexKind = (typeof ACTIVITY_INDEX_KINDS)[number]
const RESOURCE_KINDS: ReadonlySet<string> = new Set(ACTIVITY_INDEX_KINDS)
const U64_MAX = 18_446_744_073_709_551_615n

export interface ActivityIngestBody {
  companyId: number
  resources: { resource_kind: ActivityIndexKind; resource_id: string }[]
}

export interface CatalogIngestBody {
  companyId: number
  catalog: { before?: string; preview?: string }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object required')
  return value as Record<string, unknown>
}

export function parseContextIngestBody(raw: unknown): ActivityIngestBody | CatalogIngestBody {
  const body = object(raw)
  if (!Object.hasOwn(body, 'catalog')) return parseActivityIngestBody(body)
  if (Object.keys(body).some(key => key !== 'companyId' && key !== 'catalog')) {
    throw new Error('Only companyId and catalog are accepted for a catalog batch')
  }
  if (typeof body.companyId !== 'number' || !Number.isSafeInteger(body.companyId) || body.companyId <= 0) {
    throw new Error('companyId must be a positive safe integer')
  }
  const catalog = object(body.catalog)
  if (Object.keys(catalog).some(key => key !== 'before' && key !== 'preview')) {
    throw new Error('Only before and preview are accepted for a catalog batch')
  }
  const { before, preview } = catalog
  if (before !== undefined && (typeof before !== 'string' || !/^[1-9][0-9]{0,19}$/.test(before) || BigInt(before) > U64_MAX)) {
    throw new Error('Invalid catalog cursor')
  }
  if (preview !== undefined && (typeof preview !== 'string' || !/^context:catalog-preview:[0-9a-f]{64}$/.test(preview))) {
    throw new Error('Invalid catalog preview')
  }
  return { companyId: body.companyId, catalog: { before, preview } }
}

/** Accept identities only. Authority, credentials and source text come from the server. */
export function parseActivityIngestBody(raw: unknown): ActivityIngestBody {
  const body = object(raw)
  if (Object.keys(body).some(key => key !== 'companyId' && key !== 'resources')) {
    throw new Error('Only companyId and resources are accepted')
  }
  if (typeof body.companyId !== 'number' || !Number.isSafeInteger(body.companyId) || body.companyId <= 0) {
    throw new Error('companyId must be a positive safe integer')
  }
  if (!Array.isArray(body.resources) || body.resources.length < 1 || body.resources.length > 8) {
    throw new Error('One to eight resource references are required')
  }
  const seen = new Set<string>()
  const resources = body.resources.map(rawReference => {
    const reference = object(rawReference)
    if (Object.keys(reference).some(key => key !== 'resource_kind' && key !== 'resource_id')) {
      throw new Error('Only resource_kind and resource_id are accepted')
    }
    const { resource_kind, resource_id } = reference
    if (typeof resource_kind !== 'string' || !RESOURCE_KINDS.has(resource_kind)) {
      throw new Error('Unsupported resource_kind')
    }
    if (typeof resource_id !== 'string' || !/^[1-9][0-9]{0,19}$/.test(resource_id) || BigInt(resource_id) > U64_MAX) {
      throw new Error('resource_id must be a canonical positive u64 decimal string')
    }
    const key = `${resource_kind}:${resource_id}`
    if (seen.has(key)) throw new Error('Duplicate resource reference')
    seen.add(key)
    return { resource_kind: resource_kind as ActivityIndexKind, resource_id }
  })
  return { companyId: body.companyId, resources }
}
