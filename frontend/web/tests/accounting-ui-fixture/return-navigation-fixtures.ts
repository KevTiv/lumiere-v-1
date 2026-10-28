import type { AccountMove } from "../../../packages/ui/src/lib/accounting-types"
import { workflowInvoices } from "./workflow-fixtures"

export const returnJourneyScope = { organizationId: "7", companyId: "11", userId: "synthetic-refinement" }
export const returnJourneyRows: AccountMove[] = [
  ...Array.from({ length: 72 }, (_, index) => ({
    ...workflowInvoices[0]!,
    id: String(9007199254741000n + BigInt(index)),
    name: `INV/RETURN/${String(index + 1).padStart(3, "0")}`,
    invoicePartnerDisplayName: `Return journey customer ${String(index + 1).padStart(3, "0")}`,
  })),
  { ...workflowInvoices[0]!, id: "9007199254741100", currencyId: "2", name: "INV/RETURN/USD", invoicePartnerDisplayName: "Return journey USD customer" },
  { ...workflowInvoices[0]!, id: "9007199254741200", companyId: "22", name: "FOREIGN COMPANY RETURN ROW", invoicePartnerDisplayName: "Return journey foreign company" },
  { ...workflowInvoices[0]!, id: "9007199254741300", organizationId: "8", name: "FOREIGN ORGANIZATION RETURN ROW", invoicePartnerDisplayName: "Return journey foreign organization" },
]
