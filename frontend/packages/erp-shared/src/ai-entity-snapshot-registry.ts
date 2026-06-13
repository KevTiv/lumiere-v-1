/** How live snapshot SQL scopes rows to the tenant request. */
export type EntitySnapshotScope =
  | { kind: "company"; companyColumn: string; organizationColumn?: string }
  | { kind: "organization"; organizationColumn: string }
  | {
      kind: "organization_optional_company"
      organizationColumn: string
      companyColumn: string
    }

export type EntityRelationSnapshotSpec = {
  relationKey: string
  table: string
  foreignKey: string
  scope: EntitySnapshotScope
  limit: number
  promptFields: readonly string[]
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
  /** Optional related rows (e.g. order lines). */
  relations?: readonly EntityRelationSnapshotSpec[]
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
  relations: [
    {
      relationKey: "lines",
      table: "sale_order_line",
      foreignKey: "order_id",
      scope: { kind: "company", companyColumn: "company_id", organizationColumn: "organization_id" },
      limit: 20,
      promptFields: [
        "id",
        "name",
        "product_id",
        "product_uom_qty",
        "price_unit",
        "price_subtotal",
        "price_total",
      ],
    },
  ],
  labelTemplate: "Sale order #{id}",
}

const PURCHASE_ORDER: EntitySnapshotSpec = {
  entityType: "purchase_order",
  table: "purchase_order",
  scope: { kind: "company", companyColumn: "company_id", organizationColumn: "organization_id" },
  promptFields: [
    "id",
    "name",
    "state",
    "partner_id",
    "amount_total",
    "amount_untaxed",
    "amount_tax",
    "date_order",
    "invoice_status",
    "receipt_status",
    "company_id",
    "organization_id",
  ],
  relations: [
    {
      relationKey: "lines",
      table: "purchase_order_line",
      foreignKey: "order_id",
      scope: { kind: "company", companyColumn: "company_id", organizationColumn: "organization_id" },
      limit: 20,
      promptFields: ["id", "product_id", "product_qty", "price_unit", "price_subtotal", "price_total"],
    },
  ],
  labelTemplate: "Purchase order #{id}",
}

const PROJECT_TASK: EntitySnapshotSpec = {
  entityType: "project_task",
  table: "project_task",
  scope: { kind: "company", companyColumn: "company_id", organizationColumn: "organization_id" },
  promptFields: [
    "id",
    "name",
    "description",
    "priority",
    "state",
    "kanban_state",
    "project_id",
    "partner_id",
    "date_deadline",
    "progress",
    "is_closed",
    "is_blocked",
    "company_id",
    "organization_id",
  ],
  labelTemplate: "Task #{id}",
}

const ACCOUNT_MOVE: EntitySnapshotSpec = {
  entityType: "account_move",
  table: "account_move",
  scope: { kind: "company", companyColumn: "company_id", organizationColumn: "organization_id" },
  promptFields: [
    "id",
    "name",
    "ref_",
    "move_type",
    "state",
    "date",
    "partner_id",
    "amount_total",
    "amount_residual",
    "payment_state",
    "company_id",
    "organization_id",
  ],
  labelTemplate: "Journal entry #{id}",
}

const MRP_PRODUCTION: EntitySnapshotSpec = {
  entityType: "mrp_production",
  table: "mrp_production",
  scope: { kind: "company", companyColumn: "company_id", organizationColumn: "organization_id" },
  promptFields: [
    "id",
    "origin",
    "product_id",
    "product_qty",
    "qty_produced",
    "state",
    "availability",
    "date_planned_start",
    "date_planned_finished",
    "is_delayed",
    "company_id",
    "organization_id",
  ],
  labelTemplate: "Manufacturing order #{id}",
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

/** Phase 2 registry — full phase-1 entity list from harness plan. */
export const ENTITY_SNAPSHOT_REGISTRY: readonly EntitySnapshotSpec[] = [
  SALE_ORDER,
  PURCHASE_ORDER,
  PROJECT_TASK,
  ACCOUNT_MOVE,
  MRP_PRODUCTION,
  PRODUCT,
  CONTACT,
]

const REGISTRY_BY_TYPE = new Map(
  ENTITY_SNAPSHOT_REGISTRY.map((spec) => [spec.entityType, spec] as const),
)

/** Map SearchEmbedding content_type to entity_type when they align. */
export const CONTENT_TYPE_TO_ENTITY: Readonly<Record<string, string>> = {
  sale_order: "sale_order",
  purchase_order: "purchase_order",
  project_task: "project_task",
  account_move: "account_move",
  mrp_production: "mrp_production",
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

export function entityTypeAllowed(
  entityType: string,
  allowedEntityTypes?: readonly string[] | null,
): boolean {
  if (!allowedEntityTypes?.length) return true
  const key = entityType.trim().toLowerCase().replaceAll("-", "_")
  return allowedEntityTypes.some(
    (value) => value.trim().toLowerCase().replaceAll("-", "_") === key,
  )
}
