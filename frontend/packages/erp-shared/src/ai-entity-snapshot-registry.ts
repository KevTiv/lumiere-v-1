/** How live snapshot SQL scopes rows to the tenant request. */
export type EntitySnapshotScope =
  | { kind: "company"; companyColumn: string; organizationColumn?: string }
  | { kind: "organization"; organizationColumn: string }
  | {
      kind: "organization_optional_company"
      organizationColumn: string
      companyColumn: string
    }

export type EntitySnapshotSpec = {
  /** Canonical key (snake_case); matches activity ingester entity_type. */
  entityType: string
  /** SpacetimeDB table name. */
  table: string
  idColumn?: string
  scope: EntitySnapshotScope
  /** Columns safe to include in LLM prompts (snake_case STDB names). */
  promptFields: readonly string[]
  /** Display label template; `{id}` is replaced with the record id. */
  labelTemplate: string
}

const SALE_ORDER: EntitySnapshotSpec = {
  entityType: "sale_order",
  table: "sale_order",
  scope: { kind: "company", companyColumn: "company_id", organizationColumn: "organization_id" },
  promptFields: [
    "id",
    "reference",
    "state",
    "amount_total",
    "amount_untaxed",
    "amount_tax",
    "partner_id",
    "date_order",
    "invoice_status",
    "company_id",
    "organization_id",
  ],
  labelTemplate: "Sale order #{id}",
}

const PRODUCT: EntitySnapshotSpec = {
  entityType: "product",
  table: "product",
  scope: { kind: "organization", organizationColumn: "organization_id" },
  promptFields: [
    "id",
    "name",
    "display_name",
    "default_code",
    "list_price",
    "qty_available",
    "active",
    "type_",
    "organization_id",
  ],
  labelTemplate: "Product #{id}",
}

const CONTACT: EntitySnapshotSpec = {
  entityType: "contact",
  table: "contact",
  scope: {
    kind: "organization_optional_company",
    organizationColumn: "organization_id",
    companyColumn: "company_id",
  },
  promptFields: [
    "id",
    "name",
    "display_name",
    "email",
    "phone",
    "type_",
    "is_customer",
    "is_vendor",
    "company_id",
    "organization_id",
  ],
  labelTemplate: "Contact #{id}",
}

/** Phase 1 registry — expand in later harness phases. */
export const ENTITY_SNAPSHOT_REGISTRY: readonly EntitySnapshotSpec[] = [
  SALE_ORDER,
  PRODUCT,
  CONTACT,
]

const REGISTRY_BY_TYPE = new Map(
  ENTITY_SNAPSHOT_REGISTRY.map((spec) => [spec.entityType, spec] as const),
)

/** Map SearchEmbedding content_type to entity_type when they align. */
export const CONTENT_TYPE_TO_ENTITY: Readonly<Record<string, string>> = {
  product: "product",
  contact: "contact",
}

export function lookupEntitySnapshotSpec(
  entityType: string,
): EntitySnapshotSpec | undefined {
  const key = entityType.trim().toLowerCase().replaceAll("-", "_")
  if (!key) return undefined
  return REGISTRY_BY_TYPE.get(key)
}

export function contentTypeToEntityType(contentType: string): string | undefined {
  const key = contentType.trim().toLowerCase().replaceAll("-", "_")
  return CONTENT_TYPE_TO_ENTITY[key]
}

export function formatSnapshotLabel(template: string, id: number | string): string {
  return template.replace("{id}", String(id))
}
