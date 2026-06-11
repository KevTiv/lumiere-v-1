/**
 * Reports module dashboard forms → SpacetimeDB create params.
 */

import type {
  CreateDashboardParams,
  CreateDashboardWidgetParams,
  WidgetType,
} from "@lumiere/stdb/types"

function parseCompanyId(v: unknown): number | null {
  if (v == null || String(v).trim() === "") return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null
}

function toWidgetType(raw: unknown): WidgetType {
  const s = String(raw ?? "kpi").toLowerCase()
  if (s === "table") return { tag: "Table" }
  if (s === "list") return { tag: "List" }
  if (s === "chart" || s.includes("chart")) return { tag: "Chart" }
  return { tag: "Kpi" }
}

function parseU32(v: unknown, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(0xffff_ffff, Math.trunc(n))
}

/** `create_dashboard` — form uses `isActive` as “default dashboard” → `isDefault`. */
export function toCreateDashboardParams(
  formData: Record<string, unknown>,
): CreateDashboardParams {
  return {
    name: String(formData.name ?? "").trim(),
    isDefault: Boolean(formData.isDefault ?? formData.isActive ?? false),
    isSystem: Boolean(formData.isSystem ?? false),
    description:
      formData.description != null && String(formData.description).trim() !== ""
        ? String(formData.description).trim()
        : undefined,
    shareWith: [],
    shareWithGroups: [],
    metadata: undefined,
  }
}

export function companyIdFromDashboardForm(formData: Record<string, unknown>): number | null {
  return parseCompanyId(formData.companyId)
}

/** `create_dashboard_widget` — UI “dataSource” maps to ERP `model`. */
export function toCreateDashboardWidgetParams(
  formData: Record<string, unknown>,
): CreateDashboardWidgetParams {
  return {
    name: String(formData.name ?? "").trim(),
    widgetType: toWidgetType(formData.widgetType),
    model: String(formData.dataSource ?? formData.model ?? "").trim(),
    fields: [],
    positionX: parseU32(formData.positionX ?? formData.x, 0),
    positionY: parseU32(formData.positionY ?? formData.y, 0),
    width: parseU32(formData.width, 4),
    height: parseU32(formData.height, 200),
    isActive: Boolean(formData.isActive ?? true),
    domain: undefined,
    groupBy: undefined,
    aggregation: undefined,
    chartType: undefined,
    sortOrder: undefined,
    limit: undefined,
    refreshInterval: undefined,
    configuration:
      formData.config != null && String(formData.config).trim() !== ""
        ? String(formData.config)
        : undefined,
    metadata: undefined,
  }
}

export function companyIdFromDashboardWidgetForm(formData: Record<string, unknown>): number | null {
  return parseCompanyId(formData.companyId)
}
