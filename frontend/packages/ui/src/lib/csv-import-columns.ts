import type { CsvImportColumns } from "./csv-import-preview"

/**
 * Header contracts of the server `import_*_csv` reducers (spacetimedb/src/data_ops/*_imports.rs).
 * Each reducer takes the raw CSV text, lower-cases the header row and reads cells by name; a row
 * missing a required cell is skipped and recorded as an import-job error rather than failing the call.
 * `resource` is the resource the reducer checks `create` on.
 */
export interface CsvImportContract extends CsvImportColumns {
  resource: string
}

export const CSV_IMPORT_CONTRACTS = {
  project: {
    resource: "project_project",
    required: ["name"],
    optional: [
      "description", "sequence", "currency_id", "partner_id", "date_start", "date_end", "allow_subtasks",
      "allow_timesheets", "bill_type", "pricing_type", "privacy_visibility", "stage_id", "analytic_account_id", "metadata",
    ],
  },
  timesheet: {
    resource: "project_timesheet",
    required: ["project_id", "employee_id"],
    optional: [
      "encoding_uom_id", "currency_id", "date", "unit_amount", "validation_status", "employee_cost", "sell_rate", "amount",
    ],
  },
  expense: {
    resource: "hr_expense",
    required: ["name", "employee_id"],
    optional: [
      "company_id", "product_id", "date", "total_amount", "currency_id", "quantity", "unit_amount", "tax_ids", "account_id",
      "analytic_account_id", "project_id", "line_kind", "description", "payment_mode", "state", "sheet_id",
    ],
  },
  expenseSheet: {
    resource: "hr_expense_sheet",
    required: ["name", "employee_id"],
    optional: ["company_id", "state", "currency_id", "total_amount", "accounting_date", "notes"],
  },
  purchaseOrder: {
    resource: "purchase_order",
    required: ["partner_id", "currency_id"],
    optional: ["name", "origin", "partner_ref", "payment_term_id", "date_order", "date_planned", "notes", "metadata"],
  },
  purchaseOrderLine: {
    resource: "purchase_order_line",
    required: ["order_id", "product_id"],
    optional: [
      "price_unit", "product_qty", "product_uom", "currency_id", "sequence", "date_planned", "product_variant_id",
      "account_analytic_id", "metadata",
    ],
  },
  supplierInfo: {
    resource: "product_supplier_info",
    required: ["partner_id", "currency_id"],
    optional: [
      "product_tmpl_id", "product_id", "product_name", "product_code", "sequence", "min_qty", "price", "company_id",
      "date_start", "date_end", "delay", "metadata",
    ],
  },
  bom: {
    resource: "mrp_bom",
    required: ["product_id", "product_uom_id", "product_qty"],
    optional: [
      "type_", "sequence", "ready_to_produce", "consumption", "warehouse_id", "location_src_id", "location_dest_id",
      "picking_type_id", "metadata",
    ],
  },
  bomLine: {
    resource: "mrp_bom_line",
    required: ["bom_id", "product_id", "product_uom_id", "product_qty"],
    optional: ["sequence", "manual_consumption", "operation_id", "metadata"],
  },
  workcenter: {
    resource: "mrp_workcenter",
    required: ["name"],
    optional: ["code", "active", "capacity", "working_state", "time_efficiency", "oee_target", "sequence", "metadata"],
  },
  manufacturingOrder: {
    resource: "mrp_production",
    required: [
      "product_id", "product_uom_id", "product_qty", "warehouse_id", "location_src_id", "location_dest_id",
      "picking_type_id", "date_planned_start", "date_planned_finished",
    ],
    optional: ["bom_id", "origin", "date_deadline", "metadata"],
  },
} as const satisfies Record<string, CsvImportContract>

export type CsvImportContractKey = keyof typeof CSV_IMPORT_CONTRACTS
