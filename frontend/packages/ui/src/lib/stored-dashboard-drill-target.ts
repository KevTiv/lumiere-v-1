import { moduleTabHref } from "@lumiere/erp-shared/record-links"

export interface StoredDashboardDrillTarget {
  version: 1
  model: string
  sourceField: string
  sourceValue: string
  moduleId: string
  tabId: string
  href: string
}

type AdmittedDrillRoute = {
  moduleId: string
  tabId: string
  fields: ReadonlySet<string>
}

const ADMITTED_DRILL_ROUTES: Record<string, AdmittedDrillRoute> = {
  sale_order: {
    moduleId: "sales",
    tabId: "orders",
    fields: new Set(["id", "state", "partner_id", "company_id"]),
  },
  purchase_order: {
    moduleId: "purchasing",
    tabId: "orders",
    fields: new Set(["id", "state", "partner_id", "company_id"]),
  },
  account_move: {
    moduleId: "accounting",
    tabId: "journal-entries",
    fields: new Set(["id", "state", "move_type", "company_id"]),
  },
  hr_expense: {
    moduleId: "expenses",
    tabId: "expenses",
    fields: new Set(["id", "state", "employee_id", "company_id"]),
  },
  project_task: {
    moduleId: "projects",
    tabId: "tasks",
    fields: new Set(["id", "project_id", "stage_id", "company_id"]),
  },
}

function canonicalField(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

/**
 * Resolve a persisted widget category to an admitted in-app list filter.
 * Both the model and field are allowlisted; persisted definitions cannot inject paths.
 */
export function resolveStoredDashboardDrillTarget(
  model: string,
  sourceField: string,
  sourceValue: unknown,
): StoredDashboardDrillTarget | null {
  const canonicalModel = model.trim().replace(/-/g, "_")
  const field = canonicalField(sourceField.trim())
  const value = String(sourceValue ?? "").trim()
  const route = ADMITTED_DRILL_ROUTES[canonicalModel]
  if (!route || !route.fields.has(field) || !value || /[\u0000-\u001f]/.test(value)) {
    return null
  }
  return {
    version: 1,
    model: canonicalModel,
    sourceField: field,
    sourceValue: value,
    moduleId: route.moduleId,
    tabId: route.tabId,
    href: moduleTabHref(route.moduleId, route.tabId, { [field]: value }),
  }
}
