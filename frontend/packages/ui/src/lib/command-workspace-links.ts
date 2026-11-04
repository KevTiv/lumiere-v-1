import type { NavGroup } from "./navigation-catalog"

interface WorkspaceDestination {
  surfaceId: string
  tab: string
  key: string
  label: string
  aliases: string
}

const destinations: readonly WorkspaceDestination[] = [
  { surfaceId: "accounting", tab: "invoices", key: "customerInvoices", label: "Customer invoices", aliases: "invoice receivable customer payment" },
  { surfaceId: "accounting", tab: "bills", key: "vendorBills", label: "Vendor bills", aliases: "bill payable supplier vendor" },
  { surfaceId: "sales", tab: "orders", key: "quotations", label: "Quotations and sales orders", aliases: "quotation quote order" },
  { surfaceId: "crm", tab: "contacts", key: "contacts", label: "Contacts", aliases: "contact customer vendor partner" },
  { surfaceId: "purchasing", tab: "orders", key: "purchaseOrders", label: "Purchase orders", aliases: "purchase supplier order" },
  { surfaceId: "expenses", tab: "operations", key: "captureReceipt", label: "Capture receipt", aliases: "receipt capture expense upload" },
  { surfaceId: "expenses", tab: "expense-sheets", key: "expenseReports", label: "Expense reports", aliases: "expense claim reimbursement report" },
  { surfaceId: "warehouse", tab: "transfers", key: "stockTransfers", label: "Stock transfers", aliases: "stock transfer delivery movement inventory" },
  { surfaceId: "products", tab: "product-categories", key: "productCategories", label: "Product categories", aliases: "product category catalog" },
  { surfaceId: "subscriptions", tab: "due-to-bill", key: "subscriptionBilling", label: "Subscription billing", aliases: "subscription recurring invoice billing renewal" },
  { surfaceId: "documents", tab: "document-templates", key: "documentTemplates", label: "Document templates", aliases: "document template editor" },
]

/** Navigation suggestions inherit the exact admitted, authorized parent surface. */
export function buildCommandWorkspaceLinks(
  groups: readonly NavGroup[],
  t: (key: string, options: { defaultValue: string }) => string,
) {
  const parents = new Map(groups.flatMap((group) => group.items).map((item) => [item.surfaceId, item]))
  return destinations.flatMap((destination) => {
    const parent = parents.get(destination.surfaceId)
    if (!parent) return []
    const params = new URLSearchParams({ tab: destination.tab })
    return [{
      ...parent,
      href: `${parent.href}?${params}`,
      label: t(`commandPalette.workspaces.${destination.key}`, { defaultValue: destination.label }),
      keywords: destination.aliases,
    }]
  })
}
