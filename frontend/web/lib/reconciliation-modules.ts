/** Alpha discovery and review grouping. These entries confer no record access. */
type ReconciliationModule = { id: string; label: string; role: string; rules: readonly string[] }

export const reconciliationModules: readonly ReconciliationModule[] = [
  { id: "accounting", label: "Accounting", role: "Review existing bills and invoices against their source orders.", rules: ["vendor_bill_purchase", "invoice_sale", "invoice_subscription"] },
  { id: "sales", label: "Sales", role: "Trace deliveries, customers, conversions and invoices to their sales records.", rules: ["delivery_sales_line", "sale_customer", "opportunity_sale", "invoice_sale"] },
  { id: "crm", label: "CRM", role: "Review existing customer, supplier and opportunity references.", rules: ["sale_customer", "receipt_supplier", "opportunity_sale"] },
  { id: "purchasing", label: "Purchasing", role: "Review receipts, supplier items and bills against purchasing records.", rules: ["receipt_purchase_line", "supplier_product", "receipt_supplier", "vendor_bill_purchase"] },
  { id: "reports", label: "Reports", role: "Use the proposal statuses to identify evidence gaps before trusting a report.", rules: [] },
  { id: "subscriptions", label: "Subscriptions", role: "Trace invoices to an explicitly referenced subscription billing run.", rules: ["invoice_subscription"] },
  { id: "expenses", label: "Expenses", role: "Review verified receipt and fleet expense references.", rules: ["expense_receipt", "expense_fleet_intervention"] },
  { id: "products", label: "Products", role: "Review product references from stock movements and supplier items.", rules: ["movement_product", "supplier_product"] },
  { id: "warehouse", label: "Warehouse", role: "Review existing movements, returns and transfer evidence. Movement quantities still require reconciliation.", rules: ["receipt_purchase_line", "delivery_sales_line", "return_original_move", "movement_product", "transfer_fleet_intervention", "document_transfer"] },
  { id: "fleet", label: "Fleet", role: "Review documented parts transfers and expenses against vehicle interventions.", rules: ["expense_fleet_intervention", "transfer_fleet_intervention"] },
  { id: "overview", label: "Overview", role: "Use All modules for the review totals and outstanding evidence gaps.", rules: [] },
  { id: "tasks", label: "My work", role: "Use preview feedback to identify proposals that need follow-up.", rules: [] },
  { id: "approvals", label: "Approvals", role: "Preview feedback records a preference in this conversation. Formal approval requires a saved review workflow.", rules: [] },
  { id: "documents", label: "Documents", role: "Review existing transfer documents and verified expense receipts.", rules: ["document_transfer", "expense_receipt"] },
  { id: "calendar", label: "Calendar", role: "Use explicit source dates when reviewing evidence. A scheduled date alone does not prove a movement.", rules: [] },
  { id: "settings", label: "Settings", role: "Company and unit configuration provide context for reconciliation.", rules: [] },
  { id: "ai-assistant", label: "AI Assistant", role: "Open and resume this review from the current chat.", rules: [] },
]
