const RESOURCE_KINDS = new Set([
  'sale_order', 'purchase_order', 'project_task', 'account_move',
  'mrp_production', 'product', 'contact',
])
const U64_MAX = 18_446_744_073_709_551_615n

export interface ActivityIngestBody {
  companyId: number
  resources: { resource_kind: string; resource_id: string }[]
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object required')
  return value as Record<string, unknown>
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
    return { resource_kind, resource_id }
  })
  return { companyId: body.companyId, resources }
}
