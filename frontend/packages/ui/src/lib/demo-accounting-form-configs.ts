import type { FormConfig } from "./form-types"

export const newInvoiceForm: FormConfig = {
  id: "new-invoice",
  title: "New Invoice",
  description: "Create a customer invoice",
  submitLabel: "Create Invoice",
  cancelLabel: "Cancel",
  sections: [
    {
      id: "header",
      title: "Invoice Details",
      fields: [
        {
          id: "partner",
          name: "partner",
          type: "text",
          label: "Customer / Partner",
          placeholder: "Customer name",
          required: true,
          width: "1/2",
        },
        {
          id: "journal",
          name: "journalId",
          type: "select",
          label: "Journal",
          placeholder: "Select journal",
          required: true,
          width: "1/2",
          options: [
            { value: "1", label: "Customer Invoices" },
            { value: "2", label: "Miscellaneous" },
          ],
        },
        {
          id: "invoice-date",
          name: "invoiceDate",
          type: "date",
          label: "Invoice Date",
          required: true,
          width: "1/2",
        },
        {
          id: "due-date",
          name: "invoiceDateDue",
          type: "date",
          label: "Due Date",
          width: "1/2",
        },
        {
          id: "ref",
          name: "ref",
          type: "text",
          label: "Reference",
          placeholder: "PO number or reference",
          width: "full",
        },
        {
          id: "notes",
          name: "narration",
          type: "textarea",
          label: "Notes",
          placeholder: "Internal notes...",
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
}

export const newJournalEntryForm: FormConfig = {
  id: "new-journal-entry",
  title: "New Journal Entry",
  description: "Create a manual journal entry",
  submitLabel: "Create Entry",
  cancelLabel: "Cancel",
  sections: [
    {
      id: "header",
      title: "Entry Details",
      fields: [
        {
          id: "date",
          name: "date",
          type: "date",
          label: "Accounting Date",
          required: true,
          width: "1/2",
        },
        {
          id: "journal",
          name: "journalId",
          type: "select",
          label: "Journal",
          placeholder: "Select journal",
          required: true,
          width: "1/2",
          options: [
            { value: "1", label: "Miscellaneous Operations" },
            { value: "2", label: "Bank" },
            { value: "3", label: "Cash" },
          ],
        },
        {
          id: "ref",
          name: "ref",
          type: "text",
          label: "Reference",
          placeholder: "Optional reference",
          width: "full",
        },
        {
          id: "notes",
          name: "narration",
          type: "textarea",
          label: "Notes",
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
}

export const newAccountForm: FormConfig = {
  id: "new-account",
  title: "New Account",
  description: "Add a general ledger account",
  submitLabel: "Create Account",
  cancelLabel: "Cancel",
  sections: [
    {
      id: "identity",
      title: "Account Identity",
      fields: [
        {
          id: "code",
          name: "code",
          type: "text",
          label: "Account Code",
          placeholder: "e.g. 1000",
          required: true,
          width: "1/4",
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: "Account Name",
          placeholder: "e.g. Cash",
          required: true,
          width: "3/4" as "2/3",
        },
        {
          id: "internal-group",
          name: "internalGroup",
          type: "select",
          label: "Internal Group",
          required: true,
          width: "1/2",
          options: [
            { value: "asset", label: "Asset" },
            { value: "liability", label: "Liability" },
            { value: "equity", label: "Equity" },
            { value: "income", label: "Income" },
            { value: "expense", label: "Expense" },
          ],
        },
        {
          id: "internal-type",
          name: "internalType",
          type: "select",
          label: "Account Type",
          width: "1/2",
          options: [
            { value: "other", label: "Regular" },
            { value: "receivable", label: "Receivable" },
            { value: "payable", label: "Payable" },
            { value: "liquidity", label: "Bank / Cash" },
          ],
        },
        {
          id: "reconcile",
          name: "reconcile",
          type: "switch",
          label: "Allow reconciliation",
          width: "1/2",
        },
        {
          id: "note",
          name: "note",
          type: "textarea",
          label: "Notes",
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
}

export const newTaxForm: FormConfig = {
  id: "new-tax",
  title: "New Tax",
  description: "Configure a tax rate",
  submitLabel: "Create Tax",
  cancelLabel: "Cancel",
  sections: [
    {
      id: "config",
      title: "Tax Configuration",
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: "Tax Name",
          placeholder: "e.g. 15% GST",
          required: true,
          width: "1/2",
        },
        {
          id: "amount",
          name: "amount",
          type: "number",
          label: "Rate (%)",
          placeholder: "15",
          required: true,
          width: "1/4",
          validation: { min: 0, max: 100 },
        },
        {
          id: "type-tax-use",
          name: "typeTaxUse",
          type: "select",
          label: "Tax Type",
          required: true,
          width: "1/4",
          defaultValue: "sale",
          options: [
            { value: "sale", label: "Sales" },
            { value: "purchase", label: "Purchase" },
            { value: "none", label: "None" },
          ],
        },
        {
          id: "amount-type",
          name: "amountType",
          type: "select",
          label: "Computation",
          width: "1/2",
          defaultValue: "percent",
          options: [
            { value: "percent", label: "Percentage of price" },
            { value: "fixed", label: "Fixed amount" },
            { value: "division", label: "Percentage of total" },
          ],
        },
        {
          id: "price-include",
          name: "priceInclude",
          type: "switch",
          label: "Included in price",
          width: "1/2",
        },
      ],
    },
  ],
}

export const newBudgetForm: FormConfig = {
  id: "new-budget",
  title: "New Budget",
  description: "Create a budget plan",
  submitLabel: "Create Budget",
  cancelLabel: "Cancel",
  sections: [
    {
      id: "info",
      title: "Budget Information",
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: "Budget Name",
          placeholder: "e.g. FY 2025 Operations",
          required: true,
          width: "full",
        },
        {
          id: "date-from",
          name: "dateFrom",
          type: "date",
          label: "Start Date",
          required: true,
          width: "1/2",
        },
        {
          id: "date-to",
          name: "dateTo",
          type: "date",
          label: "End Date",
          required: true,
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: "Description",
          placeholder: "Budget purpose or notes...",
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
}

export const newBillForm: FormConfig = {
  id: "new-bill",
  title: "New Vendor Bill",
  description: "Create a vendor bill",
  submitLabel: "Create Bill",
  cancelLabel: "Cancel",
  sections: [
    {
      id: "header",
      title: "Bill Details",
      fields: [
        {
          id: "partner",
          name: "partner",
          type: "text",
          label: "Vendor / Partner",
          placeholder: "Vendor name",
          required: true,
          width: "1/2",
        },
        {
          id: "journal",
          name: "journalId",
          type: "select",
          label: "Journal",
          placeholder: "Select journal",
          required: true,
          width: "1/2",
          options: [
            { value: "1", label: "Vendor Bills" },
            { value: "2", label: "Miscellaneous" },
          ],
        },
        {
          id: "bill-date",
          name: "invoiceDate",
          type: "date",
          label: "Bill Date",
          required: true,
          width: "1/2",
        },
        {
          id: "due-date",
          name: "invoiceDateDue",
          type: "date",
          label: "Due Date",
          width: "1/2",
        },
        {
          id: "ref",
          name: "ref",
          type: "text",
          label: "Reference",
          placeholder: "Vendor reference",
          width: "full",
        },
        {
          id: "notes",
          name: "narration",
          type: "textarea",
          label: "Notes",
          placeholder: "Internal notes...",
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
}

export const postMoveForm: FormConfig = {
  id: "post-move",
  title: "Confirm Posting",
  description: "Post this entry to the general ledger. This action cannot be undone.",
  submitLabel: "Post Entry",
  cancelLabel: "Cancel",
  sections: [
    {
      id: "confirm",
      fields: [
        {
          id: "confirmed",
          name: "confirmed",
          type: "checkbox",
          label: "I confirm this entry is correct and ready to be posted",
          required: true,
          width: "full",
        },
      ],
    },
  ],
}

export const accountingFormConfigs: Record<string, FormConfig> = {
  "new-invoice": newInvoiceForm,
  "new-bill": newBillForm,
  "new-journal-entry": newJournalEntryForm,
  "new-account": newAccountForm,
  "new-tax": newTaxForm,
  "new-budget": newBudgetForm,
  "post-move": postMoveForm,
}
