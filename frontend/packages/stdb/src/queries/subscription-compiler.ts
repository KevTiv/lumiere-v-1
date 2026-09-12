import type { FieldAccessContext } from "../field-policy"
import { selectOrgScopedSql } from "../field-policy"
import { ORG_SUBSCRIPTION_QUERY_DESCRIPTORS } from "../generated/org-subscription-descriptors"
import type { QueryResourceKey } from "../generated/query-registry"

type Descriptor = (typeof ORG_SUBSCRIPTION_QUERY_DESCRIPTORS)[keyof typeof ORG_SUBSCRIPTION_QUERY_DESCRIPTORS]

function literal(value: string | boolean): string {
  if (typeof value === "boolean") return value ? "true" : "false"
  return `'${value.replaceAll("'", "''")}'`
}

function predicateSql(descriptor: Descriptor): string {
  return descriptor.predicates
    .map((predicate) => ` AND ${predicate.field} = ${literal(predicate.value)}`)
    .join("")
}

function orderSql(descriptor: Descriptor): string {
  if (descriptor.order_by.length === 0) return ""
  const terms = descriptor.order_by.map(
    (order) => `${order.field} ${order.direction.toUpperCase()}`,
  )
  return ` ORDER BY ${terms.join(", ")}`
}

/** Compile one reviewed structural descriptor with server-owned tenant context. */
export function compileOrganizationSubscription(
  resource: string,
  organizationId: number,
  fieldAccess?: FieldAccessContext,
): string | null {
  const descriptor = Object.prototype.hasOwnProperty.call(
    ORG_SUBSCRIPTION_QUERY_DESCRIPTORS,
    resource,
  )
    ? ORG_SUBSCRIPTION_QUERY_DESCRIPTORS[
        resource as keyof typeof ORG_SUBSCRIPTION_QUERY_DESCRIPTORS
      ]
    : undefined
  if (!descriptor) return null
  return selectOrgScopedSql(
    resource as QueryResourceKey,
    descriptor.table,
    organizationId,
    fieldAccess,
    predicateSql(descriptor),
    orderSql(descriptor),
  )
}

export const GENERATED_ORG_SUBSCRIPTION_RESOURCE_KEYS = Object.freeze(
  Object.keys(ORG_SUBSCRIPTION_QUERY_DESCRIPTORS),
)
