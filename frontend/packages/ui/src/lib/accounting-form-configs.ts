import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export const newInvoiceForm = (t: TFunction): FormConfig => ({
  id: "new-invoice",
  title: t("accounting.forms.newInvoice.title"),
  description: t("accounting.forms.newInvoice.description"),
  submitLabel: t("accounting.forms.newInvoice.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "header",
      title: t("accounting.forms.newInvoice.sections.header"),
      fields: [
        {
          id: "partner",
          name: "partner",
          type: "text",
          label: t("accounting.forms.newInvoice.fields.partner"),
          placeholder: t("accounting.forms.newInvoice.fields.partnerPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "journal",
          name: "journalId",
          type: "select",
          label: t("accounting.forms.newInvoice.fields.journal"),
          placeholder: t("accounting.forms.newInvoice.fields.journalPlaceholder"),
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
          label: t("accounting.forms.newInvoice.fields.invoiceDate"),
          required: true,
          width: "1/2",
        },
        {
          id: "due-date",
          name: "invoiceDateDue",
          type: "date",
          label: t("accounting.forms.newInvoice.fields.dueDate"),
          width: "1/2",
        },
        {
          id: "ref",
          name: "ref",
          type: "text",
          label: t("accounting.forms.newInvoice.fields.ref"),
          placeholder: t("accounting.forms.newInvoice.fields.refPlaceholder"),
          width: "full",
        },
        {
          id: "notes",
          name: "narration",
          type: "textarea",
          label: t("accounting.forms.newInvoice.fields.notes"),
          placeholder: t("accounting.forms.newInvoice.fields.notesPlaceholder"),
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
})

export const newJournalEntryForm = (t: TFunction): FormConfig => ({
  id: "new-journal-entry",
  title: t("accounting.forms.newJournalEntry.title"),
  description: t("accounting.forms.newJournalEntry.description"),
  submitLabel: t("accounting.forms.newJournalEntry.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "header",
      title: t("accounting.forms.newJournalEntry.sections.header"),
      fields: [
        {
          id: "date",
          name: "date",
          type: "date",
          label: t("accounting.forms.newJournalEntry.fields.date"),
          required: true,
          width: "1/2",
        },
        {
          id: "journal",
          name: "journalId",
          type: "select",
          label: t("accounting.forms.newJournalEntry.fields.journal"),
          placeholder: t("accounting.forms.newJournalEntry.fields.journalPlaceholder"),
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
          label: t("accounting.forms.newJournalEntry.fields.ref"),
          placeholder: t("accounting.forms.newJournalEntry.fields.refPlaceholder"),
          width: "full",
        },
        {
          id: "notes",
          name: "narration",
          type: "textarea",
          label: t("accounting.forms.newJournalEntry.fields.notes"),
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
})

export const newAccountForm = (t: TFunction): FormConfig => ({
  id: "new-account",
  title: t("accounting.forms.newAccount.title"),
  description: t("accounting.forms.newAccount.description"),
  submitLabel: t("accounting.forms.newAccount.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "identity",
      title: t("accounting.forms.newAccount.sections.identity"),
      fields: [
        {
          id: "code",
          name: "code",
          type: "text",
          label: t("accounting.forms.newAccount.fields.code"),
          placeholder: t("accounting.forms.newAccount.fields.codePlaceholder"),
          required: true,
          width: "1/4",
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.newAccount.fields.name"),
          placeholder: t("accounting.forms.newAccount.fields.namePlaceholder"),
          required: true,
          width: "2/3",
        },
        {
          id: "internal-group",
          name: "internalGroup",
          type: "select",
          label: t("accounting.forms.newAccount.fields.internalGroup"),
          required: true,
          width: "1/2",
          options: [
            { value: "asset", label: t("accounting.forms.newAccount.fields.options.asset") },
            { value: "liability", label: t("accounting.forms.newAccount.fields.options.liability") },
            { value: "equity", label: t("accounting.forms.newAccount.fields.options.equity") },
            { value: "income", label: t("accounting.forms.newAccount.fields.options.income") },
            { value: "expense", label: t("accounting.forms.newAccount.fields.options.expense") },
          ],
        },
        {
          id: "internal-type",
          name: "internalType",
          type: "select",
          label: t("accounting.forms.newAccount.fields.internalType"),
          width: "1/2",
          options: [
            { value: "other", label: t("accounting.forms.newAccount.fields.options.other") },
            { value: "receivable", label: t("accounting.forms.newAccount.fields.options.receivable") },
            { value: "payable", label: t("accounting.forms.newAccount.fields.options.payable") },
            { value: "liquidity", label: t("accounting.forms.newAccount.fields.options.liquidity") },
          ],
        },
        {
          id: "reconcile",
          name: "reconcile",
          type: "switch",
          label: t("accounting.forms.newAccount.fields.reconcile"),
          width: "1/2",
        },
        {
          id: "note",
          name: "note",
          type: "textarea",
          label: t("accounting.forms.newAccount.fields.notes"),
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
})

export const newTaxForm = (t: TFunction): FormConfig => ({
  id: "new-tax",
  title: t("accounting.forms.newTax.title"),
  description: t("accounting.forms.newTax.description"),
  submitLabel: t("accounting.forms.newTax.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "config",
      title: t("accounting.forms.newTax.sections.config"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.newTax.fields.name"),
          placeholder: t("accounting.forms.newTax.fields.namePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "amount",
          name: "amount",
          type: "number",
          label: t("accounting.forms.newTax.fields.amount"),
          placeholder: "15",
          required: true,
          width: "1/4",
          validation: { min: 0, max: 100 },
        },
        {
          id: "type-tax-use",
          name: "typeTaxUse",
          type: "select",
          label: t("accounting.forms.newTax.fields.taxType"),
          required: true,
          width: "1/4",
          defaultValue: "sale",
          options: [
            { value: "sale", label: t("accounting.forms.newTax.fields.options.sale") },
            { value: "purchase", label: t("accounting.forms.newTax.fields.options.purchase") },
            { value: "none", label: t("accounting.forms.newTax.fields.options.none") },
          ],
        },
        {
          id: "amount-type",
          name: "amountType",
          type: "select",
          label: t("accounting.forms.newTax.fields.computation"),
          width: "1/2",
          defaultValue: "percent",
          options: [
            { value: "percent", label: t("accounting.forms.newTax.fields.options.percent") },
            { value: "fixed", label: t("accounting.forms.newTax.fields.options.fixed") },
            { value: "division", label: t("accounting.forms.newTax.fields.options.division") },
          ],
        },
        {
          id: "price-include",
          name: "priceInclude",
          type: "switch",
          label: t("accounting.forms.newTax.fields.priceInclude"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const newBudgetForm = (t: TFunction): FormConfig => ({
  id: "new-budget",
  title: t("accounting.forms.newBudget.title"),
  description: t("accounting.forms.newBudget.description"),
  submitLabel: t("accounting.forms.newBudget.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "info",
      title: t("accounting.forms.newBudget.sections.info"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.newBudget.fields.name"),
          placeholder: t("accounting.forms.newBudget.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "date-from",
          name: "dateFrom",
          type: "date",
          label: t("accounting.forms.newBudget.fields.dateFrom"),
          required: true,
          width: "1/2",
        },
        {
          id: "date-to",
          name: "dateTo",
          type: "date",
          label: t("accounting.forms.newBudget.fields.dateTo"),
          required: true,
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("accounting.forms.newBudget.fields.description"),
          placeholder: t("accounting.forms.newBudget.fields.descriptionPlaceholder"),
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
})

export const newBillForm = (t: TFunction): FormConfig => ({
  id: "new-bill",
  title: t("accounting.forms.newBill.title"),
  description: t("accounting.forms.newBill.description"),
  submitLabel: t("accounting.forms.newBill.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "header",
      title: t("accounting.forms.newBill.sections.header"),
      fields: [
        {
          id: "partner",
          name: "partner",
          type: "text",
          label: t("accounting.forms.newBill.fields.partner"),
          placeholder: t("accounting.forms.newBill.fields.partnerPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "journal",
          name: "journalId",
          type: "select",
          label: t("accounting.forms.newBill.fields.journal"),
          placeholder: t("accounting.forms.newBill.fields.journalPlaceholder"),
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
          label: t("accounting.forms.newBill.fields.billDate"),
          required: true,
          width: "1/2",
        },
        {
          id: "due-date",
          name: "invoiceDateDue",
          type: "date",
          label: t("accounting.forms.newBill.fields.dueDate"),
          width: "1/2",
        },
        {
          id: "ref",
          name: "ref",
          type: "text",
          label: t("accounting.forms.newBill.fields.ref"),
          placeholder: t("accounting.forms.newBill.fields.refPlaceholder"),
          width: "full",
        },
        {
          id: "notes",
          name: "narration",
          type: "textarea",
          label: t("accounting.forms.newBill.fields.notes"),
          placeholder: t("accounting.forms.newBill.fields.notesPlaceholder"),
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
})

export const postMoveForm = (t: TFunction): FormConfig => ({
  id: "post-move",
  title: t("accounting.forms.postMove.title"),
  description: t("accounting.forms.postMove.description"),
  submitLabel: t("accounting.forms.postMove.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "confirm",
      fields: [
        {
          id: "confirmed",
          name: "confirmed",
          type: "checkbox",
          label: t("accounting.forms.postMove.fields.confirmed"),
          required: true,
          width: "full",
        },
      ],
    },
  ],
})

export const accountingFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-invoice": newInvoiceForm(t),
  "new-bill": newBillForm(t),
  "new-journal-entry": newJournalEntryForm(t),
  "new-account": newAccountForm(t),
  "new-tax": newTaxForm(t),
  "new-budget": newBudgetForm(t),
  "post-move": postMoveForm(t),
})
