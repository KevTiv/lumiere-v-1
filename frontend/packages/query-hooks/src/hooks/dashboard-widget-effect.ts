import { dashboardWidgetCreationMetadata } from "@lumiere/erp-shared/reports-dashboard-params"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import {
  resolveUniqueEffect,
  type CanonicalRecordRef,
} from "./operation-effect"

export interface DashboardWidgetEffectRef extends CanonicalRecordRef {
  readonly resource: "dashboard-widgets"
  readonly href: string
}

export interface DashboardEffectRef extends CanonicalRecordRef {
  readonly resource: "dashboards"
  readonly href: string
}

export interface DashboardWidgetProjection {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly metadata?: unknown
}

export interface DashboardProjection {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly widgetIds?: unknown
  readonly widget_ids?: unknown
}

/** Resolve one widget by its producer-enforced creation request key. */
export function resolveDashboardWidgetCreationEffect(
  rows: readonly DashboardWidgetProjection[],
  organizationId: bigint,
  creationRequestId: string,
): DashboardWidgetEffectRef | null {
  const metadata = dashboardWidgetCreationMetadata(creationRequestId)
  return resolveUniqueEffect(
    rows,
    (row) =>
      parseStrictU64(row.organizationId ?? row.organization_id) === organizationId &&
      row.metadata === metadata,
    (row) => {
      const id = parseStrictU64(row.id)
      if (id == null) throw new Error("Dashboard widget has an invalid id")
      return {
        resource: "dashboard-widgets",
        id: id.toString(),
        href: `/reports?tab=dashboard-widgets&filter=id:${id}`,
      }
    },
  )
}

/** Resolve the exact dashboard only after its canonical widget_ids relation contains the widget. */
export function resolveDashboardWidgetAttachmentEffect(
  rows: readonly DashboardProjection[],
  organizationId: bigint,
  dashboardId: bigint,
  widgetId: bigint,
): DashboardEffectRef | null {
  return resolveUniqueEffect(
    rows,
    (row) => {
      const rawIds = row.widgetIds ?? row.widget_ids
      return (
        parseStrictU64(row.id) === dashboardId &&
        parseStrictU64(row.organizationId ?? row.organization_id) === organizationId &&
        Array.isArray(rawIds) &&
        rawIds.some((candidate) => parseStrictU64(candidate) === widgetId)
      )
    },
    () => ({
      resource: "dashboards",
      id: dashboardId.toString(),
      href: `/reports?tab=dashboards&filter=id:${dashboardId}`,
    }),
  )
}
