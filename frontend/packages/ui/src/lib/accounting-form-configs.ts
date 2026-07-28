import type { TFunction } from "i18next"
import type { FormConfig, FormField } from "./form-types"

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
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("accounting.forms.newTax.fields.description"),
          placeholder: t("accounting.forms.newTax.fields.descriptionPlaceholder"),
          width: "full",
        },
        {
          id: "sequence",
          name: "sequence",
          type: "hidden",
          defaultValue: "1",
        },
        {
          id: "tax-group-id",
          name: "taxGroupId",
          type: "hidden",
          defaultValue: "",
        },
        {
          id: "country-id",
          name: "countryId",
          type: "hidden",
          defaultValue: "",
        },
        {
          id: "country-code",
          name: "countryCode",
          type: "hidden",
          defaultValue: "",
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

/** Budget position (budget post) — create or edit; empty `postId` means create. */
export const budgetPostForm = (t: TFunction): FormConfig => ({
  id: "budget-post",
  title: t("accounting.forms.budgetPost.title"),
  description: t("accounting.forms.budgetPost.description"),
  submitLabel: t("accounting.forms.budgetPost.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.budgetPost.sections.main"),
      fields: [
        { id: "postId", name: "postId", type: "hidden", defaultValue: "" },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.budgetPost.fields.name"),
          placeholder: t("accounting.forms.budgetPost.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "code",
          name: "code",
          type: "text",
          label: t("accounting.forms.budgetPost.fields.code"),
          placeholder: t("accounting.forms.budgetPost.fields.codePlaceholder"),
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("accounting.forms.budgetPost.fields.description"),
          placeholder: t("accounting.forms.budgetPost.fields.descriptionPlaceholder"),
          width: "full",
          rows: 2,
        },
        {
          id: "accountIds",
          name: "accountIds",
          type: "text",
          label: t("accounting.forms.budgetPost.fields.accountIds"),
          placeholder: t("accounting.forms.budgetPost.fields.accountIdsPlaceholder"),
          width: "full",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "switch",
          label: t("accounting.forms.budgetPost.fields.isActive"),
          defaultValue: true,
          width: "1/2",
        },
      ],
    },
  ],
})

export const updateBudgetLineActualsForm = (t: TFunction): FormConfig => ({
  id: "update-budget-line-actuals",
  title: t("accounting.forms.updateBudgetLineActuals.title"),
  description: t("accounting.forms.updateBudgetLineActuals.description"),
  submitLabel: t("accounting.forms.updateBudgetLineActuals.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "amounts",
      fields: [
        { id: "lineId", name: "lineId", type: "hidden", defaultValue: "" },
        {
          id: "practicalAmount",
          name: "practicalAmount",
          type: "number",
          label: t("accounting.forms.updateBudgetLineActuals.fields.practicalAmount"),
          required: true,
          step: 0.01,
          width: "1/2",
        },
        {
          id: "theoreticalAmount",
          name: "theoreticalAmount",
          type: "number",
          label: t("accounting.forms.updateBudgetLineActuals.fields.theoreticalAmount"),
          required: true,
          step: 0.01,
          width: "1/2",
        },
      ],
    },
  ],
})

function internalGroupSelectField(t: TFunction, id: string) {
  return {
    id,
    name: "internalGroup" as const,
    type: "select" as const,
    label: t("accounting.forms.newAccount.fields.internalGroup"),
    required: true,
    width: "1/2" as const,
    options: [
      { value: "asset", label: t("accounting.forms.newAccount.fields.options.asset") },
      { value: "liability", label: t("accounting.forms.newAccount.fields.options.liability") },
      { value: "equity", label: t("accounting.forms.newAccount.fields.options.equity") },
      { value: "income", label: t("accounting.forms.newAccount.fields.options.income") },
      { value: "expense", label: t("accounting.forms.newAccount.fields.options.expense") },
      { value: "other", label: t("accounting.forms.newAccount.fields.options.other") },
    ],
  }
}

/** Account classification type (user type); empty `typeId` ⇒ create. */
export const accountAccountTypeForm = (t: TFunction): FormConfig => ({
  id: "account-account-type",
  title: t("accounting.forms.accountAccountType.title"),
  description: t("accounting.forms.accountAccountType.description"),
  submitLabel: t("accounting.forms.accountAccountType.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.accountAccountType.sections.main"),
      fields: [
        { id: "typeId", name: "typeId", type: "hidden", defaultValue: "" },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.accountAccountType.fields.name"),
          placeholder: t("accounting.forms.accountAccountType.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "typeKey",
          name: "type",
          type: "text",
          label: t("accounting.forms.accountAccountType.fields.typeKey"),
          placeholder: t("accounting.forms.accountAccountType.fields.typeKeyPlaceholder"),
          required: true,
          width: "1/2",
        },
        internalGroupSelectField(t, "internalGroup-field"),
        {
          id: "includeInitialBalance",
          name: "includeInitialBalance",
          type: "switch",
          label: t("accounting.forms.accountAccountType.fields.includeInitialBalance"),
          defaultValue: false,
          width: "1/2",
        },
        {
          id: "isDeprecated",
          name: "isDeprecated",
          type: "switch",
          label: t("accounting.forms.accountAccountType.fields.isDeprecated"),
          defaultValue: false,
          width: "1/2",
        },
        {
          id: "metadata",
          name: "metadata",
          type: "textarea",
          label: t("accounting.forms.accountAccountType.fields.metadata"),
          placeholder: t("accounting.forms.accountAccountType.fields.metadataPlaceholder"),
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
})

/** Account group (hierarchy); empty `groupId` ⇒ create. Parent is set on create only. */
export const accountGroupForm = (t: TFunction): FormConfig => ({
  id: "account-group",
  title: t("accounting.forms.accountGroup.title"),
  description: t("accounting.forms.accountGroup.description"),
  submitLabel: t("accounting.forms.accountGroup.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.accountGroup.sections.main"),
      fields: [
        { id: "groupId", name: "groupId", type: "hidden", defaultValue: "" },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.accountGroup.fields.name"),
          placeholder: t("accounting.forms.accountGroup.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "level",
          name: "level",
          type: "number",
          label: t("accounting.forms.accountGroup.fields.level"),
          defaultValue: 0,
          width: "1/4",
        },
        {
          id: "codePrefixStart",
          name: "codePrefixStart",
          type: "text",
          label: t("accounting.forms.accountGroup.fields.codePrefixStart"),
          width: "1/4",
        },
        {
          id: "codePrefixEnd",
          name: "codePrefixEnd",
          type: "text",
          label: t("accounting.forms.accountGroup.fields.codePrefixEnd"),
          width: "1/4",
        },
        {
          id: "parentId",
          name: "parentId",
          type: "select",
          label: t("accounting.forms.accountGroup.fields.parentId"),
          width: "full",
          options: [{ value: "", label: t("accounting.forms.accountGroup.noParent") }],
        },
        {
          id: "metadata",
          name: "metadata",
          type: "textarea",
          label: t("accounting.forms.accountGroup.fields.metadata"),
          placeholder: t("accounting.forms.accountGroup.fields.metadataPlaceholder"),
          width: "full",
          rows: 2,
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

export const createCreditNoteForm = (t: TFunction): FormConfig => ({
  id: "create-credit-note",
  title: t("accounting.forms.createCreditNote.title"),
  description: t("accounting.forms.createCreditNote.description"),
  submitLabel: t("accounting.forms.createCreditNote.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.createCreditNote.sections.main"),
      fields: [
        { id: "invoiceId", name: "invoiceId", type: "hidden", defaultValue: "" },
        {
          id: "reason",
          name: "reason",
          type: "textarea",
          label: t("accounting.forms.createCreditNote.fields.reason"),
          placeholder: t("accounting.forms.createCreditNote.fields.reasonPlaceholder"),
          width: "full",
          rows: 3,
        },
        {
          id: "confirmed",
          name: "confirmed",
          type: "checkbox",
          label: t("accounting.forms.createCreditNote.fields.confirmed"),
          required: true,
          width: "full",
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

export const recordPaymentForm = (t: TFunction): FormConfig => ({
  id: "record-payment",
  title: t("accounting.forms.recordPayment.title"),
  description: t("accounting.forms.recordPayment.description"),
  submitLabel: t("accounting.forms.recordPayment.submitLabel"),
  cancelLabel: t("common.cancel"),
  size: "md",
  sections: [
    {
      id: "payment",
      title: t("accounting.forms.recordPayment.sections.payment"),
      fields: [
        {
          id: "amount",
          name: "amount",
          type: "number",
          label: t("accounting.forms.recordPayment.fields.amount"),
          required: true,
          width: "full",
          step: 0.01,
          validation: { min: 0.01 },
        },
        {
          id: "memo",
          name: "memo",
          type: "text",
          label: t("accounting.forms.recordPayment.fields.memo"),
          placeholder: t("accounting.forms.recordPayment.fields.memoPlaceholder"),
          width: "full",
        },
      ],
    },
  ],
})

export const newAccountPaymentForm = (t: TFunction): FormConfig => ({
  id: "new-account-payment",
  title: t("accounting.forms.newAccountPayment.title"),
  description: t("accounting.forms.newAccountPayment.description"),
  submitLabel: t("accounting.forms.newAccountPayment.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.newAccountPayment.sections.main"),
      fields: [
        {
          id: "paymentType",
          name: "paymentType",
          type: "select",
          label: t("accounting.forms.newAccountPayment.fields.paymentType"),
          required: true,
          width: "1/2",
          defaultValue: "InBound",
          options: [
            { value: "InBound", label: t("accounting.forms.newAccountPayment.fields.paymentTypeInbound") },
            { value: "OutBound", label: t("accounting.forms.newAccountPayment.fields.paymentTypeOutbound") },
          ],
        },
        {
          id: "partnerType",
          name: "partnerType",
          type: "select",
          label: t("accounting.forms.newAccountPayment.fields.partnerType"),
          required: true,
          width: "1/2",
          defaultValue: "Customer",
          options: [
            { value: "Customer", label: t("accounting.forms.newAccountPayment.fields.partnerTypeCustomer") },
            { value: "Supplier", label: t("accounting.forms.newAccountPayment.fields.partnerTypeSupplier") },
          ],
        },
        {
          id: "partnerId",
          name: "partnerId",
          type: "select",
          label: t("accounting.forms.newAccountPayment.fields.partnerId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "amount",
          name: "amount",
          type: "number",
          label: t("accounting.forms.newAccountPayment.fields.amount"),
          required: true,
          width: "1/2",
          step: 0.01,
          validation: { min: 0.01 },
        },
        {
          id: "currencyId",
          name: "currencyId",
          type: "select",
          label: t("accounting.forms.newAccountPayment.fields.currencyId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "journalId",
          name: "journalId",
          type: "select",
          label: t("accounting.forms.newAccountPayment.fields.journalId"),
          required: true,
          width: "full",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "ref",
          name: "ref",
          type: "text",
          label: t("accounting.forms.newAccountPayment.fields.ref"),
          width: "1/2",
        },
        {
          id: "memo",
          name: "memo",
          type: "text",
          label: t("accounting.forms.newAccountPayment.fields.memo"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const newPaymentTermForm = (t: TFunction): FormConfig => ({
  id: "new-payment-term",
  title: t("accounting.forms.newPaymentTerm.title"),
  description: t("accounting.forms.newPaymentTerm.description"),
  submitLabel: t("accounting.forms.newPaymentTerm.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.newPaymentTerm.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.newPaymentTerm.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "note",
          name: "note",
          type: "textarea",
          label: t("accounting.forms.newPaymentTerm.fields.note"),
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
})

export const newPaymentTermLineForm = (t: TFunction): FormConfig => ({
  id: "new-payment-term-line",
  title: t("accounting.forms.newPaymentTermLine.title"),
  description: t("accounting.forms.newPaymentTermLine.description"),
  submitLabel: t("accounting.forms.newPaymentTermLine.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.newPaymentTermLine.sections.main"),
      fields: [
        {
          id: "paymentTermId",
          name: "paymentTermId",
          type: "select",
          label: t("accounting.forms.newPaymentTermLine.fields.paymentTermId"),
          required: true,
          width: "full",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "value",
          name: "value",
          type: "select",
          label: t("accounting.forms.newPaymentTermLine.fields.value"),
          required: true,
          width: "1/2",
          defaultValue: "Balance",
          options: [
            { value: "Balance", label: t("accounting.forms.newPaymentTermLine.fields.valueBalance") },
            { value: "Percent", label: t("accounting.forms.newPaymentTermLine.fields.valuePercent") },
            { value: "Fixed", label: t("accounting.forms.newPaymentTermLine.fields.valueFixed") },
          ],
        },
        {
          id: "valueAmount",
          name: "valueAmount",
          type: "number",
          label: t("accounting.forms.newPaymentTermLine.fields.valueAmount"),
          width: "1/2",
          defaultValue: 0,
          step: 0.01,
        },
        {
          id: "days",
          name: "days",
          type: "number",
          label: t("accounting.forms.newPaymentTermLine.fields.days"),
          width: "1/3",
          defaultValue: 0,
        },
        {
          id: "months",
          name: "months",
          type: "number",
          label: t("accounting.forms.newPaymentTermLine.fields.months"),
          width: "1/3",
          defaultValue: 0,
        },
        {
          id: "sequence",
          name: "sequence",
          type: "number",
          label: t("accounting.forms.newPaymentTermLine.fields.sequence"),
          width: "1/3",
          defaultValue: 0,
        },
        {
          id: "daysAfterEndOfMonth",
          name: "daysAfterEndOfMonth",
          type: "switch",
          label: t("accounting.forms.newPaymentTermLine.fields.daysAfterEndOfMonth"),
          width: "full",
        },
      ],
    },
  ],
})

export const editPaymentTermLineForm = (t: TFunction): FormConfig => ({
  id: "edit-payment-term-line",
  title: t("accounting.forms.editPaymentTermLine.title"),
  description: t("accounting.forms.editPaymentTermLine.description"),
  submitLabel: t("accounting.forms.editPaymentTermLine.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.editPaymentTermLine.sections.main"),
      fields: [
        {
          id: "value",
          name: "value",
          type: "select",
          label: t("accounting.forms.newPaymentTermLine.fields.value"),
          width: "1/2",
          options: [
            { value: "Balance", label: t("accounting.forms.newPaymentTermLine.fields.valueBalance") },
            { value: "Percent", label: t("accounting.forms.newPaymentTermLine.fields.valuePercent") },
            { value: "Fixed", label: t("accounting.forms.newPaymentTermLine.fields.valueFixed") },
          ],
        },
        {
          id: "valueAmount",
          name: "valueAmount",
          type: "number",
          label: t("accounting.forms.newPaymentTermLine.fields.valueAmount"),
          width: "1/2",
          step: 0.01,
        },
        {
          id: "days",
          name: "days",
          type: "number",
          label: t("accounting.forms.newPaymentTermLine.fields.days"),
          width: "1/3",
        },
        {
          id: "months",
          name: "months",
          type: "number",
          label: t("accounting.forms.newPaymentTermLine.fields.months"),
          width: "1/3",
        },
        {
          id: "sequence",
          name: "sequence",
          type: "number",
          label: t("accounting.forms.newPaymentTermLine.fields.sequence"),
          width: "1/3",
        },
        {
          id: "daysAfterEndOfMonth",
          name: "daysAfterEndOfMonth",
          type: "switch",
          label: t("accounting.forms.newPaymentTermLine.fields.daysAfterEndOfMonth"),
          width: "full",
        },
      ],
    },
  ],
})

export const newAccountJournalForm = (t: TFunction): FormConfig => ({
  id: "new-account-journal",
  title: t("accounting.forms.newAccountJournal.title"),
  description: t("accounting.forms.newAccountJournal.description"),
  submitLabel: t("accounting.forms.newAccountJournal.submitLabel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.newAccountJournal.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.newAccountJournal.fields.name"),
          required: true,
          width: "1/2",
        },
        {
          id: "code",
          name: "code",
          type: "text",
          label: t("accounting.forms.newAccountJournal.fields.code"),
          required: true,
          width: "1/2",
        },
        {
          id: "type",
          name: "type",
          type: "select",
          label: t("accounting.forms.newAccountJournal.fields.type"),
          required: true,
          width: "1/2",
          defaultValue: "Sale",
          options: [
            { value: "Sale", label: t("accounting.forms.newAccountJournal.fields.typeSale") },
            { value: "Purchase", label: t("accounting.forms.newAccountJournal.fields.typePurchase") },
            { value: "Bank", label: t("accounting.forms.newAccountJournal.fields.typeBank") },
            { value: "Cash", label: t("accounting.forms.newAccountJournal.fields.typeCash") },
            { value: "General", label: t("accounting.forms.newAccountJournal.fields.typeGeneral") },
          ],
        },
        {
          id: "active",
          name: "active",
          type: "checkbox",
          label: t("accounting.forms.newAccountJournal.fields.active"),
          defaultValue: true,
          width: "1/2",
        },
      ],
    },
  ],
})

export const editAccountJournalForm = (t: TFunction): FormConfig => ({
  id: "edit-account-journal",
  title: t("accounting.forms.editAccountJournal.title"),
  submitLabel: t("accounting.forms.editAccountJournal.submitLabel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.editAccountJournal.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.newAccountJournal.fields.name"),
          width: "1/2",
        },
        {
          id: "code",
          name: "code",
          type: "text",
          label: t("accounting.forms.newAccountJournal.fields.code"),
          width: "1/2",
        },
        {
          id: "active",
          name: "active",
          type: "checkbox",
          label: t("accounting.forms.newAccountJournal.fields.active"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const newDepreciationLineForm = (t: TFunction): FormConfig => ({
  id: "new-depreciation-line",
  title: t("accounting.forms.newDepreciationLine.title"),
  description: t("accounting.forms.newDepreciationLine.description"),
  submitLabel: t("accounting.forms.newDepreciationLine.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "line",
      title: t("accounting.forms.newDepreciationLine.sections.line"),
      fields: [
        {
          id: "assetId",
          name: "assetId",
          type: "select",
          label: t("accounting.forms.newDepreciationLine.fields.assetId"),
          required: true,
          width: "full",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.newDepreciationLine.fields.name"),
          width: "full",
        },
        {
          id: "depreciationDate",
          name: "depreciationDate",
          type: "date",
          label: t("accounting.forms.newDepreciationLine.fields.depreciationDate"),
          required: true,
          width: "1/2",
        },
        {
          id: "amount",
          name: "amount",
          type: "number",
          label: t("accounting.forms.newDepreciationLine.fields.amount"),
          required: true,
          width: "1/2",
          step: 0.01,
          min: 0,
        },
        {
          id: "moveId",
          name: "moveId",
          type: "select",
          label: t("accounting.forms.newDepreciationLine.fields.moveId"),
          width: "full",
          options: [{ value: "", label: "—", disabled: true }],
        },
      ],
    },
  ],
})

export const newIntercompanyRuleForm = (t: TFunction): FormConfig => ({
  id: "new-intercompany-rule",
  title: t("accounting.forms.newIntercompanyRule.title"),
  description: t("accounting.forms.newIntercompanyRule.description"),
  submitLabel: t("accounting.forms.newIntercompanyRule.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.newIntercompanyRule.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.newIntercompanyRule.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "ruleType",
          name: "ruleType",
          type: "select",
          label: t("accounting.forms.newIntercompanyRule.fields.ruleType"),
          required: true,
          width: "1/2",
          options: [
            { value: "Sale", label: t("accounting.entities.intercompanyRules.filters.ruleType.options.Sale") },
            { value: "Purchase", label: t("accounting.entities.intercompanyRules.filters.ruleType.options.Purchase") },
            { value: "Transfer", label: t("accounting.entities.intercompanyRules.filters.ruleType.options.Transfer") },
            { value: "Service", label: t("accounting.entities.intercompanyRules.filters.ruleType.options.Service") },
          ],
        },
        {
          id: "sourceCompanyId",
          name: "sourceCompanyId",
          type: "select",
          label: t("accounting.forms.newIntercompanyRule.fields.sourceCompanyId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "destinationCompanyId",
          name: "destinationCompanyId",
          type: "select",
          label: t("accounting.forms.newIntercompanyRule.fields.destinationCompanyId"),
          required: true,
          width: "full",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "journalId",
          name: "journalId",
          type: "select",
          label: t("accounting.forms.newIntercompanyRule.fields.journalId"),
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "accountId",
          name: "accountId",
          type: "select",
          label: t("accounting.forms.newIntercompanyRule.fields.accountId"),
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "autoValidation",
          name: "autoValidation",
          type: "checkbox",
          label: t("accounting.forms.newIntercompanyRule.fields.autoValidation"),
          width: "1/2",
        },
        {
          id: "autoGenerateInvoice",
          name: "autoGenerateInvoice",
          type: "checkbox",
          label: t("accounting.forms.newIntercompanyRule.fields.autoGenerateInvoice"),
          width: "1/2",
        },
        {
          id: "autoGenerateBill",
          name: "autoGenerateBill",
          type: "checkbox",
          label: t("accounting.forms.newIntercompanyRule.fields.autoGenerateBill"),
          width: "1/2",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          label: t("accounting.forms.newIntercompanyRule.fields.isActive"),
          width: "1/2",
          defaultValue: true,
        },
      ],
    },
  ],
})

export const editIntercompanyRuleForm = (t: TFunction): FormConfig => ({
  id: "edit-intercompany-rule",
  title: t("accounting.forms.editIntercompanyRule.title"),
  description: t("accounting.forms.editIntercompanyRule.description"),
  submitLabel: t("accounting.forms.editIntercompanyRule.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.editIntercompanyRule.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.newIntercompanyRule.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "sequence",
          name: "sequence",
          type: "number",
          label: t("accounting.forms.editIntercompanyRule.fields.sequence"),
          width: "1/3",
        },
        {
          id: "journalId",
          name: "journalId",
          type: "select",
          label: t("accounting.forms.newIntercompanyRule.fields.journalId"),
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "accountId",
          name: "accountId",
          type: "select",
          label: t("accounting.forms.newIntercompanyRule.fields.accountId"),
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "autoValidation",
          name: "autoValidation",
          type: "checkbox",
          label: t("accounting.forms.newIntercompanyRule.fields.autoValidation"),
          width: "1/3",
        },
        {
          id: "autoGenerateInvoice",
          name: "autoGenerateInvoice",
          type: "checkbox",
          label: t("accounting.forms.newIntercompanyRule.fields.autoGenerateInvoice"),
          width: "1/3",
        },
        {
          id: "autoGenerateBill",
          name: "autoGenerateBill",
          type: "checkbox",
          label: t("accounting.forms.newIntercompanyRule.fields.autoGenerateBill"),
          width: "1/3",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          label: t("accounting.forms.newIntercompanyRule.fields.isActive"),
          width: "1/3",
        },
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("accounting.forms.editIntercompanyRule.fields.notes"),
          width: "full",
        },
      ],
    },
  ],
})

export const newIntercompanyTransactionForm = (t: TFunction): FormConfig => ({
  id: "new-intercompany-transaction",
  title: t("accounting.forms.newIntercompanyTransaction.title"),
  description: t("accounting.forms.newIntercompanyTransaction.description"),
  submitLabel: t("accounting.forms.newIntercompanyTransaction.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.newIntercompanyTransaction.sections.main"),
      fields: [
        {
          id: "originDocumentModel",
          name: "originDocumentModel",
          type: "select",
          label: t("accounting.forms.newIntercompanyTransaction.fields.originDocumentModel"),
          required: true,
          width: "1/2",
          defaultValue: "account.move",
          options: [
            {
              value: "account.move",
              label: t("accounting.forms.newIntercompanyTransaction.fields.originDocumentModels.accountMove"),
            },
            {
              value: "sale.order",
              label: t("accounting.forms.newIntercompanyTransaction.fields.originDocumentModels.saleOrder"),
            },
          ],
        },
        {
          id: "originDocumentId",
          name: "originDocumentId",
          type: "select",
          label: t("accounting.forms.newIntercompanyTransaction.fields.originDocumentId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "destinationCompanyId",
          name: "destinationCompanyId",
          type: "select",
          label: t("accounting.forms.newIntercompanyTransaction.fields.destinationCompanyId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "transactionType",
          name: "transactionType",
          type: "select",
          label: t("accounting.forms.newIntercompanyTransaction.fields.transactionType"),
          required: true,
          width: "1/2",
          options: [
            { value: "Sale", label: t("accounting.entities.intercompanyRules.filters.ruleType.options.Sale") },
            { value: "Purchase", label: t("accounting.entities.intercompanyRules.filters.ruleType.options.Purchase") },
            { value: "Transfer", label: t("accounting.entities.intercompanyRules.filters.ruleType.options.Transfer") },
            { value: "Service", label: t("accounting.entities.intercompanyRules.filters.ruleType.options.Service") },
          ],
        },
        {
          id: "amount",
          name: "amount",
          type: "number",
          label: t("accounting.forms.newIntercompanyTransaction.fields.amount"),
          required: true,
          width: "1/3",
          step: 0.01,
          min: 0,
        },
        {
          id: "currencyId",
          name: "currencyId",
          type: "select",
          label: t("accounting.forms.newIntercompanyTransaction.fields.currencyId"),
          required: true,
          width: "1/3",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "requiresApproval",
          name: "requiresApproval",
          type: "checkbox",
          label: t("accounting.forms.newIntercompanyTransaction.fields.requiresApproval"),
          width: "1/3",
          defaultValue: true,
        },
        {
          id: "autoProcess",
          name: "autoProcess",
          type: "checkbox",
          label: t("accounting.forms.newIntercompanyTransaction.fields.autoProcess"),
          width: "1/2",
        },
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("accounting.forms.newIntercompanyTransaction.fields.notes"),
          width: "full",
        },
      ],
    },
  ],
})

export const markIntercompanyTransactionErrorForm = (t: TFunction): FormConfig => ({
  id: "mark-intercompany-transaction-error",
  title: t("accounting.forms.markIntercompanyTransactionError.title"),
  description: t("accounting.forms.markIntercompanyTransactionError.description"),
  submitLabel: t("accounting.forms.markIntercompanyTransactionError.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.markIntercompanyTransactionError.sections.main"),
      fields: [
        {
          id: "errorMessage",
          name: "errorMessage",
          type: "textarea",
          label: t("accounting.forms.markIntercompanyTransactionError.fields.errorMessage"),
          required: true,
          width: "full",
        },
      ],
    },
  ],
})

export const editAccountMoveLineForm = (t: TFunction): FormConfig => ({
  id: "edit-account-move-line",
  title: t("accounting.forms.editAccountMoveLine.title"),
  description: t("accounting.forms.editAccountMoveLine.description"),
  submitLabel: t("accounting.forms.editAccountMoveLine.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "line",
      title: t("accounting.forms.editAccountMoveLine.sections.line"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.addAccountMoveLine.fields.name"),
          width: "full",
        },
        {
          id: "debit",
          name: "debit",
          type: "number",
          label: t("accounting.forms.addAccountMoveLine.fields.debit"),
          width: "1/2",
          step: 0.01,
        },
        {
          id: "credit",
          name: "credit",
          type: "number",
          label: t("accounting.forms.addAccountMoveLine.fields.credit"),
          width: "1/2",
          step: 0.01,
        },
      ],
    },
  ],
})

export const addAccountMoveLineForm = (t: TFunction): FormConfig => ({
  id: "add-account-move-line",
  title: t("accounting.forms.addAccountMoveLine.title"),
  description: t("accounting.forms.addAccountMoveLine.description"),
  submitLabel: t("accounting.forms.addAccountMoveLine.submitLabel"),
  sections: [
    {
      id: "line",
      title: t("accounting.forms.addAccountMoveLine.sections.line"),
      fields: [
        {
          id: "moveId",
          name: "moveId",
          type: "select",
          label: t("accounting.forms.addAccountMoveLine.fields.moveId"),
          required: true,
          width: "full",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "accountId",
          name: "accountId",
          type: "select",
          label: t("accounting.forms.addAccountMoveLine.fields.accountId"),
          required: true,
          width: "full",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.addAccountMoveLine.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "debit",
          name: "debit",
          type: "number",
          label: t("accounting.forms.addAccountMoveLine.fields.debit"),
          width: "1/2",
          defaultValue: 0,
          step: 0.01,
        },
        {
          id: "credit",
          name: "credit",
          type: "number",
          label: t("accounting.forms.addAccountMoveLine.fields.credit"),
          width: "1/2",
          defaultValue: 0,
          step: 0.01,
        },
      ],
    },
  ],
})

export const newCurrencyRateForm = (t: TFunction): FormConfig => ({
  id: "new-currency-rate",
  title: t("accounting.forms.newCurrencyRate.title"),
  description: t("accounting.forms.newCurrencyRate.description"),
  submitLabel: t("accounting.forms.newCurrencyRate.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.newCurrencyRate.sections.main"),
      fields: [
        {
          id: "fromCurrency",
          name: "fromCurrency",
          type: "text",
          label: t("accounting.forms.newCurrencyRate.fields.fromCurrency"),
          required: true,
          width: "1/2",
          placeholder: "USD",
        },
        {
          id: "toCurrency",
          name: "toCurrency",
          type: "text",
          label: t("accounting.forms.newCurrencyRate.fields.toCurrency"),
          required: true,
          width: "1/2",
          placeholder: "EUR",
        },
        {
          id: "rate",
          name: "rate",
          type: "number",
          label: t("accounting.forms.newCurrencyRate.fields.rate"),
          required: true,
          width: "full",
          step: 0.00000001,
          validation: { min: 0.00000001 },
        },
        {
          id: "metadata",
          name: "metadata",
          type: "text",
          label: t("accounting.forms.newCurrencyRate.fields.metadata"),
          width: "full",
        },
      ],
    },
  ],
})

export const registerPaymentInvoicesForm = (t: TFunction): FormConfig => ({
  id: "register-payment-invoices",
  title: t("accounting.forms.registerPaymentInvoices.title"),
  description: t("accounting.forms.registerPaymentInvoices.description"),
  submitLabel: t("accounting.forms.registerPaymentInvoices.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.registerPaymentInvoices.sections.main"),
      fields: [
        {
          id: "invoiceIds",
          name: "invoiceIds",
          type: "select",
          label: t("accounting.forms.registerPaymentInvoices.fields.invoiceIds"),
          required: true,
          width: "full",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "isBill",
          name: "isBill",
          type: "switch",
          label: t("accounting.forms.registerPaymentInvoices.fields.isBill"),
          width: "full",
        },
      ],
    },
  ],
})

export const reconcilePaymentInvoiceForm = (t: TFunction): FormConfig => ({
  id: "reconcile-payment-invoice",
  title: t("accounting.forms.reconcilePaymentInvoice.title"),
  description: t("accounting.forms.reconcilePaymentInvoice.description"),
  submitLabel: t("accounting.forms.reconcilePaymentInvoice.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.reconcilePaymentInvoice.sections.main"),
      fields: [
        {
          id: "paymentMoveId",
          name: "paymentMoveId",
          type: "select",
          label: t("accounting.forms.reconcilePaymentInvoice.fields.paymentMoveId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "invoiceMoveId",
          name: "invoiceMoveId",
          type: "select",
          label: t("accounting.forms.reconcilePaymentInvoice.fields.invoiceMoveId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
      ],
    },
  ],
})

export const newAnalyticAccountForm = (t: TFunction): FormConfig => ({
  id: "new-analytic-account",
  title: t("accounting.forms.analyticAccount.createTitle"),
  description: t("accounting.forms.analyticAccount.createDescription"),
  submitLabel: t("accounting.forms.analyticAccount.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.analyticAccount.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.analyticAccount.fields.name"),
          required: true,
          width: "1/2",
        },
        {
          id: "code",
          name: "code",
          type: "text",
          label: t("accounting.forms.analyticAccount.fields.code"),
          width: "1/2",
        },
        {
          id: "currencyId",
          name: "currencyId",
          type: "select",
          label: t("accounting.forms.analyticAccount.fields.currencyId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "active",
          name: "active",
          type: "checkbox",
          label: t("accounting.forms.analyticAccount.fields.active"),
          defaultValue: true,
          width: "1/2",
        },
        {
          id: "isRequiredInMoveLines",
          name: "isRequiredInMoveLines",
          type: "checkbox",
          label: t("accounting.forms.analyticAccount.fields.isRequiredInMoveLines"),
          width: "full",
        },
        {
          id: "isRequiredInDistribution",
          name: "isRequiredInDistribution",
          type: "checkbox",
          label: t("accounting.forms.analyticAccount.fields.isRequiredInDistribution"),
          width: "full",
        },
        {
          id: "isRootPlan",
          name: "isRootPlan",
          type: "checkbox",
          label: t("accounting.forms.analyticAccount.fields.isRootPlan"),
          width: "full",
        },
      ],
    },
  ],
})

export const newAnalyticLineForm = (t: TFunction): FormConfig => ({
  id: "new-analytic-line",
  title: t("accounting.forms.analyticLine.createTitle"),
  description: t("accounting.forms.analyticLine.createDescription"),
  submitLabel: t("accounting.forms.analyticLine.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.analyticLine.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.analyticLine.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "accountId",
          name: "accountId",
          type: "select",
          label: t("accounting.forms.analyticLine.fields.accountId"),
          required: true,
          width: "full",
          options: [{ value: "", label: t("common.lookup.noAnalyticAccounts"), disabled: true }],
        },
        {
          id: "amount",
          name: "amount",
          type: "number",
          label: t("accounting.forms.analyticLine.fields.amount"),
          required: true,
          width: "1/2",
          step: 0.01,
        },
        {
          id: "unitAmount",
          name: "unitAmount",
          type: "number",
          label: t("accounting.forms.analyticLine.fields.unitAmount"),
          width: "1/2",
          step: 0.01,
        },
        {
          id: "date",
          name: "date",
          type: "date",
          label: t("accounting.forms.analyticLine.fields.date"),
          required: true,
          width: "full",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("accounting.forms.analyticLine.fields.description"),
          width: "full",
          rows: 2,
        },
        {
          id: "tagIds",
          name: "tagIds",
          type: "text",
          label: t("accounting.forms.analyticLine.fields.tagIds"),
          placeholder: t("accounting.forms.analyticLine.fields.tagIdsHint"),
          width: "full",
        },
      ],
    },
  ],
})

export const editAnalyticAccountForm = (t: TFunction): FormConfig => ({
  id: "edit-analytic-account",
  title: t("accounting.forms.analyticAccount.editTitle"),
  submitLabel: t("common.save"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.analyticAccount.sections.main"),
      fields: [
        {
          id: "accountId",
          name: "accountId",
          type: "hidden",
          defaultValue: "",
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.analyticAccount.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "code",
          name: "code",
          type: "text",
          label: t("accounting.forms.analyticAccount.fields.code"),
          width: "full",
        },
        {
          id: "isRequiredInMoveLines",
          name: "isRequiredInMoveLines",
          type: "checkbox",
          label: t("accounting.forms.analyticAccount.fields.isRequiredInMoveLines"),
          defaultValue: false,
          width: "full",
        },
        {
          id: "active",
          name: "active",
          type: "switch",
          label: t("accounting.forms.analyticAccount.fields.accountActive"),
          defaultValue: true,
          width: "full",
        },
      ],
    },
  ],
})

export const editAnalyticLineForm = (t: TFunction): FormConfig => ({
  id: "edit-analytic-line",
  title: t("accounting.forms.analyticLine.editTitle"),
  submitLabel: t("common.save"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.analyticLine.sections.main"),
      fields: [
        {
          id: "lineId",
          name: "lineId",
          type: "hidden",
          defaultValue: "",
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.analyticLine.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "amount",
          name: "amount",
          type: "number",
          label: t("accounting.forms.analyticLine.fields.amount"),
          required: true,
          width: "full",
          step: 0.01,
        },
        {
          id: "tagIds",
          name: "tagIds",
          type: "text",
          label: t("accounting.forms.analyticLine.fields.tagIds"),
          placeholder: t("accounting.forms.analyticLine.fields.tagIdsHint"),
          width: "full",
        },
      ],
    },
  ],
})

export const editAnalyticDistributionModelForm = (t: TFunction): FormConfig => ({
  id: "edit-analytic-distribution-model",
  title: t("accounting.forms.analyticDistribution.editTitle"),
  submitLabel: t("common.save"),
  cancelLabel: t("common.cancel"),
  size: "lg",
  sections: [
    {
      id: "main",
      title: t("accounting.forms.analyticDistribution.sections.main"),
      fields: [
        {
          id: "modelId",
          name: "modelId",
          type: "hidden",
          defaultValue: "",
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.analyticDistribution.fields.name"),
          width: "full",
        },
        {
          id: "analyticDistribution",
          name: "analyticDistribution",
          type: "textarea",
          label: t("accounting.forms.analyticDistribution.fields.analyticDistributionJson"),
          width: "full",
          rows: 6,
        },
        {
          id: "isActive",
          name: "isActive",
          type: "switch",
          label: t("accounting.forms.analyticDistribution.fields.isActive"),
          defaultValue: true,
          width: "full",
        },
      ],
    },
  ],
})

export interface NewBankStatementLineFormParams {
  statementId: string
  /** Default line currency (statement currency), as string for hidden field */
  defaultCurrencyId: string
}

/**
 * Form builder: add a bank statement line (used with {@link mergeFieldDefaultValues} for statement context).
 */
export function newBankStatementLineForm(t: TFunction, p: NewBankStatementLineFormParams): FormConfig {
  return {
    id: `new-bank-statement-line-${p.statementId}`,
    title: t("accounting.forms.bankStatementLine.createTitle"),
    description: t("accounting.forms.bankStatementLine.createDescription"),
    submitLabel: t("accounting.forms.bankStatementLine.submitLabel"),
    cancelLabel: t("common.cancel"),
    size: "md",
    sections: [
      {
        id: "main",
        title: t("accounting.forms.bankStatementLine.sections.main"),
        columns: 2,
        fields: [
          {
            type: "hidden",
            id: "statementId",
            name: "statementId",
            defaultValue: p.statementId,
          },
          {
            type: "hidden",
            id: "currencyId",
            name: "currencyId",
            defaultValue: p.defaultCurrencyId,
          },
          {
            type: "date",
            id: "date",
            name: "date",
            label: t("accounting.forms.bankStatementLine.fields.date"),
            required: true,
            width: "1/2",
          },
          {
            type: "number",
            id: "amount",
            name: "amount",
            label: t("accounting.forms.bankStatementLine.fields.amount"),
            required: true,
            width: "1/2",
          },
          {
            type: "number",
            id: "amountCurrency",
            name: "amountCurrency",
            label: t("accounting.forms.bankStatementLine.fields.amountCurrency"),
            width: "1/2",
          },
          {
            type: "select",
            id: "partnerId",
            name: "partnerId",
            label: t("accounting.forms.bankStatementLine.fields.partnerId"),
            width: "1/2",
            options: [{ value: "", label: "—" }],
          },
          {
            type: "text",
            id: "accountNumber",
            name: "accountNumber",
            label: t("accounting.forms.bankStatementLine.fields.accountNumber"),
            width: "1/2",
          },
          {
            type: "text",
            id: "transactionType",
            name: "transactionType",
            label: t("accounting.forms.bankStatementLine.fields.transactionType"),
            placeholder: t("accounting.forms.bankStatementLine.fields.transactionTypePlaceholder"),
            width: "1/2",
          },
        ],
      },
    ],
  }
}

export interface EditBankStatementLineFormParams {
  lineId: string
  date: string
  amount: number
  amountCurrency: number
  accountNumber: string
  transactionType: string
}

export function editBankStatementLineForm(t: TFunction, p: EditBankStatementLineFormParams): FormConfig {
  return {
    id: `edit-bank-statement-line-${p.lineId}`,
    title: t("accounting.forms.bankStatementLine.editTitle"),
    description: t("accounting.forms.bankStatementLine.editDescription"),
    submitLabel: t("common.save"),
    cancelLabel: t("common.cancel"),
    size: "md",
    sections: [
      {
        id: "main",
        title: t("accounting.forms.bankStatementLine.sections.main"),
        columns: 2,
        fields: [
          {
            type: "hidden",
            id: "lineId",
            name: "lineId",
            defaultValue: p.lineId,
          },
          {
            type: "date",
            id: "date",
            name: "date",
            label: t("accounting.forms.bankStatementLine.fields.date"),
            required: true,
            defaultValue: p.date,
            width: "1/2",
          },
          {
            type: "number",
            id: "amount",
            name: "amount",
            label: t("accounting.forms.bankStatementLine.fields.amount"),
            required: true,
            defaultValue: p.amount,
            width: "1/2",
          },
          {
            type: "number",
            id: "amountCurrency",
            name: "amountCurrency",
            label: t("accounting.forms.bankStatementLine.fields.amountCurrency"),
            defaultValue: p.amountCurrency,
            width: "1/2",
          },
          {
            type: "text",
            id: "accountNumber",
            name: "accountNumber",
            label: t("accounting.forms.bankStatementLine.fields.accountNumber"),
            defaultValue: p.accountNumber,
            width: "1/2",
          },
          {
            type: "text",
            id: "transactionType",
            name: "transactionType",
            label: t("accounting.forms.bankStatementLine.fields.transactionType"),
            defaultValue: p.transactionType,
            width: "1/2",
          },
        ],
      },
    ],
  }
}

export function newReconciliationWidgetForm(t: TFunction): FormConfig {
  return {
    id: "new-reconciliation-widget",
    title: t("accounting.forms.reconciliationWidget.createTitle"),
    description: t("accounting.forms.reconciliationWidget.createDescription"),
    submitLabel: t("accounting.forms.reconciliationWidget.submitLabel"),
    cancelLabel: t("common.cancel"),
    size: "lg",
    sections: [
      {
        id: "main",
        title: t("accounting.forms.reconciliationWidget.sections.main"),
        columns: 2,
        fields: [
          {
            type: "select",
            id: "accountId",
            name: "accountId",
            label: t("accounting.forms.reconciliationWidget.fields.accountId"),
            required: true,
            width: "full",
            options: [{ value: "", label: t("common.noData"), disabled: true }],
          },
          {
            type: "select",
            id: "partnerId",
            name: "partnerId",
            label: t("accounting.forms.reconciliationWidget.fields.partnerId"),
            width: "1/2",
            options: [{ value: "", label: "—" }],
          },
          {
            type: "text",
            id: "mode",
            name: "mode",
            label: t("accounting.forms.reconciliationWidget.fields.mode"),
            defaultValue: "bank",
            width: "1/2",
          },
          {
            type: "textarea",
            id: "moveLineIds",
            name: "moveLineIds",
            label: t("accounting.forms.reconciliationWidget.fields.moveLineIds"),
            description: t("accounting.forms.reconciliationWidget.fields.moveLineIdsHint"),
            required: true,
            rows: 4,
            width: "full",
          },
          {
            type: "switch",
            id: "toCheck",
            name: "toCheck",
            label: t("accounting.forms.reconciliationWidget.fields.toCheck"),
            defaultValue: false,
            width: "full",
          },
        ],
      },
    ],
  }
}

export interface EditReconciliationWidgetFormParams {
  widgetId: string
  accountId: string
  partnerId: string
  mode: string
  moveLineIds: string
  toCheck: boolean
}

export function editReconciliationWidgetForm(t: TFunction, p: EditReconciliationWidgetFormParams): FormConfig {
  return {
    id: `edit-reconciliation-widget-${p.widgetId}`,
    title: t("accounting.forms.reconciliationWidget.editTitle"),
    description: t("accounting.forms.reconciliationWidget.editDescription"),
    submitLabel: t("common.save"),
    cancelLabel: t("common.cancel"),
    size: "lg",
    sections: [
      {
        id: "main",
        title: t("accounting.forms.reconciliationWidget.sections.main"),
        columns: 2,
        fields: [
          {
            type: "hidden",
            id: "widgetId",
            name: "widgetId",
            defaultValue: p.widgetId,
          },
          {
            type: "select",
            id: "accountId",
            name: "accountId",
            label: t("accounting.forms.reconciliationWidget.fields.accountId"),
            required: true,
            defaultValue: p.accountId,
            width: "full",
            options: [{ value: "", label: t("common.noData"), disabled: true }],
          },
          {
            type: "select",
            id: "partnerId",
            name: "partnerId",
            label: t("accounting.forms.reconciliationWidget.fields.partnerId"),
            defaultValue: p.partnerId,
            width: "1/2",
            options: [{ value: "", label: "—" }],
          },
          {
            type: "text",
            id: "mode",
            name: "mode",
            label: t("accounting.forms.reconciliationWidget.fields.mode"),
            defaultValue: p.mode,
            width: "1/2",
          },
          {
            type: "textarea",
            id: "moveLineIds",
            name: "moveLineIds",
            label: t("accounting.forms.reconciliationWidget.fields.moveLineIds"),
            description: t("accounting.forms.reconciliationWidget.fields.moveLineIdsHint"),
            defaultValue: p.moveLineIds,
            rows: 4,
            width: "full",
          },
          {
            type: "switch",
            id: "toCheck",
            name: "toCheck",
            label: t("accounting.forms.reconciliationWidget.fields.toCheck"),
            defaultValue: p.toCheck,
            width: "full",
          },
        ],
      },
    ],
  }
}

export const newAnalyticDistributionModelForm = (t: TFunction): FormConfig => ({
  id: "new-analytic-distribution-model",
  title: t("accounting.forms.analyticDistribution.createTitle"),
  description: t("accounting.forms.analyticDistribution.createDescription"),
  submitLabel: t("accounting.forms.analyticDistribution.submitLabel"),
  cancelLabel: t("common.cancel"),
  size: "lg",
  sections: [
    {
      id: "main",
      title: t("accounting.forms.analyticDistribution.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.forms.analyticDistribution.fields.name"),
          width: "full",
        },
        {
          id: "analyticAccountId",
          name: "analyticAccountId",
          type: "select",
          label: t("accounting.forms.analyticDistribution.fields.analyticAccountId"),
          required: true,
          width: "full",
          options: [{ value: "", label: t("common.lookup.noAnalyticAccounts"), disabled: true }],
        },
        {
          id: "analyticPrecision",
          name: "analyticPrecision",
          type: "number",
          label: t("accounting.forms.analyticDistribution.fields.analyticPrecision"),
          width: "1/2",
          defaultValue: 2,
        },
      ],
    },
  ],
})

export const newOperationalPaymentAccountForm = (t: TFunction): FormConfig => ({
  id: "new-operational-payment-account",
  title: t("accounting.forms.operationalPaymentAccount.title"),
  description: t("accounting.forms.operationalPaymentAccount.description"),
  submitLabel: t("accounting.forms.operationalPaymentAccount.submit"),
  cancelLabel: t("common.cancel"),
  sections: [{
    id: "account",
    fields: [
      { id: "providerCode", name: "providerCode", type: "select", label: t("accounting.forms.operationalPaymentAccount.provider"), required: true, width: "1/2", defaultValue: "Mtn", options: [
        { value: "Mtn", label: "MTN Mobile Money" }, { value: "Orange", label: "Orange Money" }, { value: "Airtel", label: "Airtel Money" }, { value: "Mpesa", label: "M-Pesa" }, { value: "Moov", label: "Moov Money" }, { value: "Wave", label: "Wave" }, { value: "Cash", label: t("accounting.forms.operationalPaymentAccount.cash") }, { value: "Bank", label: t("accounting.forms.operationalPaymentAccount.bank") }, { value: "Other", label: "Other" },
      ] },
      { id: "providerLabel", name: "providerLabel", type: "text", label: "Other provider label", width: "1/2" },
      { id: "name", name: "name", type: "text", label: t("accounting.forms.operationalPaymentAccount.name"), required: true, width: "1/2" },
      { id: "referenceRaw", name: "referenceRaw", type: "text", label: t("accounting.forms.operationalPaymentAccount.reference"), width: "1/2" },
      { id: "currencyId", name: "currencyId", type: "select", label: t("accounting.forms.operationalPaymentAccount.currency"), required: true, width: "1/4", options: [] },
      { id: "accountJournalId", name: "accountJournalId", type: "select", label: t("accounting.forms.operationalPaymentAccount.journal"), required: true, width: "1/2", options: [] },
      { id: "feeAccountId", name: "feeAccountId", type: "select", label: "Fee expense account", width: "1/2", options: [] },
      { id: "clearingAccountId", name: "clearingAccountId", type: "select", label: "Clearing account", width: "1/2", options: [] },
      { id: "isPrimary", name: "isPrimary", type: "switch", label: t("accounting.forms.operationalPaymentAccount.primary"), width: "1/4" },
    ],
  }],
})

export const newOperationalPaymentTransactionForm = (t: TFunction): FormConfig => ({
  id: "new-operational-payment-transaction",
  title: t("accounting.forms.operationalPaymentTransaction.title"),
  description: t("accounting.forms.operationalPaymentTransaction.description"),
  submitLabel: t("accounting.forms.operationalPaymentTransaction.submit"),
  cancelLabel: t("common.cancel"),
  sections: [{
    id: "transaction",
    fields: [
      { id: "paymentAccountId", name: "paymentAccountId", type: "select", label: t("accounting.forms.operationalPaymentTransaction.account"), required: true, width: "1/2", options: [] },
      { id: "direction", name: "direction", type: "select", label: t("accounting.forms.operationalPaymentTransaction.direction"), required: true, width: "1/4", defaultValue: "Inbound", options: [{ value: "Inbound", label: t("accounting.forms.operationalPaymentTransaction.inbound") }, { value: "Outbound", label: t("accounting.forms.operationalPaymentTransaction.outbound") }] },
      { id: "partnerType", name: "partnerType", type: "select", label: t("accounting.forms.operationalPaymentTransaction.partnerType"), required: true, width: "1/4", defaultValue: "Customer", options: [{ value: "Customer", label: t("accounting.forms.operationalPaymentTransaction.customer") }, { value: "Supplier", label: t("accounting.forms.operationalPaymentTransaction.supplier") }] },
      { id: "partnerId", name: "partnerId", type: "select", label: t("accounting.forms.operationalPaymentTransaction.partner"), required: true, width: "1/2", options: [] },
      { id: "externalReference", name: "externalReference", type: "text", label: t("accounting.forms.operationalPaymentTransaction.reference"), width: "1/2" },
      { id: "occurredAt", name: "occurredAt", type: "datetime", label: t("accounting.forms.operationalPaymentTransaction.occurredAt"), required: true, width: "1/2" },
      { id: "grossExternalAmount", name: "grossExternalAmount", type: "number", label: t("accounting.forms.operationalPaymentTransaction.gross"), required: true, width: "1/3", validation: { min: 0 } },
      { id: "settlementAmount", name: "settlementAmount", type: "number", label: t("accounting.forms.operationalPaymentTransaction.settlement"), required: true, width: "1/3", validation: { min: 0 } },
      { id: "netAccountAmount", name: "netAccountAmount", type: "number", label: t("accounting.forms.operationalPaymentTransaction.net"), required: true, width: "1/3", validation: { min: 0 } },
      { id: "currencyId", name: "currencyId", type: "select", label: t("accounting.forms.operationalPaymentTransaction.currency"), required: true, width: "1/2", options: [] },
      { id: "sourceEntity", name: "sourceEntity", type: "text", label: "Source record type", width: "1/3" },
      { id: "sourceEntityId", name: "sourceEntityId", type: "number", label: "Source record ID", width: "1/3", validation: { min: 1 } },
      { id: "evidenceDocumentIds", name: "evidenceDocumentIds", type: "text", label: "Evidence document IDs", width: "1/3" },
    ],
  }],
})

export const allocateOperationalPaymentForm = (t: TFunction): FormConfig => ({
  id: "allocate-operational-payment",
  title: t("accounting.forms.allocateOperationalPayment.title"),
  description: t("accounting.forms.allocateOperationalPayment.description"),
  submitLabel: t("accounting.forms.allocateOperationalPayment.submit"),
  cancelLabel: t("common.cancel"),
  sections: [{ id: "allocation", fields: [
    { id: "allocatedMoveLineId", name: "allocatedMoveLineId", type: "select", label: t("accounting.forms.allocateOperationalPayment.moveLine"), required: true, width: "full", options: [] },
    { id: "allocatedAmount", name: "allocatedAmount", type: "number", label: t("accounting.forms.allocateOperationalPayment.amount"), required: true, width: "1/2", validation: { min: 0 } },
    { id: "writeOffAmount", name: "writeOffAmount", type: "number", label: t("accounting.forms.allocateOperationalPayment.writeOff"), width: "1/2", defaultValue: 0, validation: { min: 0 } },
    { id: "writeOffAccountId", name: "writeOffAccountId", type: "select", label: t("accounting.creditControl.writeOffForm.fields.writeOffAccountId"), width: "full", options: [] },
  ] }],
})

export const reverseOperationalPaymentForm = (t: TFunction): FormConfig => ({
  id: "reverse-operational-payment",
  title: t("accounting.forms.reverseOperationalPayment.title"),
  description: t("accounting.forms.reverseOperationalPayment.description"),
  submitLabel: t("accounting.forms.reverseOperationalPayment.submit"),
  cancelLabel: t("common.cancel"),
  sections: [{ id: "reason", fields: [{ id: "reason", name: "reason", type: "textarea", label: t("accounting.forms.reverseOperationalPayment.reason"), required: true, width: "full", rows: 3 }] }],
})

export const newOperationalPaymentFeeForm = (t: TFunction): FormConfig => ({
  id: "new-operational-payment-fee",
  title: t("accounting.forms.operationalPaymentFee.title"),
  description: t("accounting.forms.operationalPaymentFee.description"),
  submitLabel: t("accounting.forms.operationalPaymentFee.submit"),
  cancelLabel: t("common.cancel"),
  sections: [{ id: "fee", fields: [
    { id: "bearer", name: "bearer", type: "select", label: t("accounting.forms.operationalPaymentFee.bearer"), required: true, width: "1/2", defaultValue: "Company", options: [
      { value: "Company", label: t("accounting.forms.operationalPaymentFee.company") },
      { value: "Customer", label: t("accounting.forms.operationalPaymentFee.customer") },
      { value: "Supplier", label: t("accounting.forms.operationalPaymentFee.supplier") },
    ] },
    { id: "amount", name: "amount", type: "number", label: t("accounting.forms.operationalPaymentFee.amount"), required: true, width: "1/2", validation: { min: 0 } },
    { id: "taxAmount", name: "taxAmount", type: "number", label: t("accounting.forms.operationalPaymentFee.taxAmount"), defaultValue: 0, width: "1/2", validation: { min: 0 } },
    { id: "feeAccountId", name: "feeAccountId", type: "select", label: "Fee expense account", width: "1/2", options: [] },
    { id: "taxAccountId", name: "taxAccountId", type: "select", label: "Fee tax account", width: "1/2", options: [] },
    { id: "providerReference", name: "providerReference", type: "text", label: t("accounting.forms.operationalPaymentFee.reference"), width: "1/2" },
  ] }],
})

export const stageBankStatementImportForm = (t: TFunction): FormConfig => ({
  id: "stage-bank-statement-import",
  title: t("accounting.forms.bankStatementImport.title"),
  description: t("accounting.forms.bankStatementImport.description"),
  submitLabel: t("accounting.forms.bankStatementImport.submit"),
  cancelLabel: t("common.cancel"),
  sections: [{
    id: "statement",
    fields: [
      { id: "fileName", name: "fileName", type: "text", label: t("accounting.forms.bankStatementImport.fileName"), width: "1/2" },
      { id: "journalId", name: "journalId", type: "select", label: t("accounting.forms.bankStatementImport.journal"), required: true, width: "1/2", options: [] },
      { id: "currencyId", name: "currencyId", type: "select", label: t("accounting.forms.bankStatementImport.currency"), required: true, width: "1/2", options: [] },
      { id: "openingBalance", name: "openingBalance", type: "number", label: t("accounting.forms.bankStatementImport.openingBalance"), required: true, defaultValue: 0, width: "1/2" },
      { id: "csvFile", name: "csvFile", type: "file", label: t("accounting.forms.bankStatementImport.csvData"), accept: ".csv,text/csv,text/plain", required: true, width: "full" },
    ],
  }],
})

export const accountingFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-invoice": newInvoiceForm(t),
  "new-bill": newBillForm(t),
  "new-journal-entry": newJournalEntryForm(t),
  "new-account": newAccountForm(t),
  "new-tax": newTaxForm(t),
  "new-operational-payment-account": newOperationalPaymentAccountForm(t),
  "new-operational-payment-transaction": newOperationalPaymentTransactionForm(t),
  "allocate-operational-payment": allocateOperationalPaymentForm(t),
  "reverse-operational-payment": reverseOperationalPaymentForm(t),
  "new-operational-payment-fee": newOperationalPaymentFeeForm(t),
  "stage-bank-statement-import": stageBankStatementImportForm(t),
  "new-budget": newBudgetForm(t),
  "budget-post": budgetPostForm(t),
  "update-budget-line-actuals": updateBudgetLineActualsForm(t),
  "account-account-type": accountAccountTypeForm(t),
  "account-group": accountGroupForm(t),
  "create-credit-note": createCreditNoteForm(t),
  "post-move": postMoveForm(t),
  "record-payment": recordPaymentForm(t),
  "new-analytic-account": newAnalyticAccountForm(t),
  "new-analytic-line": newAnalyticLineForm(t),
  "new-analytic-distribution-model": newAnalyticDistributionModelForm(t),
  "edit-analytic-account": editAnalyticAccountForm(t),
  "edit-analytic-line": editAnalyticLineForm(t),
  "edit-analytic-distribution-model": editAnalyticDistributionModelForm(t),
  "new-bank-statement-line": newBankStatementLineForm(t, {
    statementId: "",
    defaultCurrencyId: "1",
  }),
  "edit-bank-statement-line": editBankStatementLineForm(t, {
    lineId: "",
    date: "",
    amount: 0,
    amountCurrency: 0,
    accountNumber: "",
    transactionType: "",
  }),
  "new-reconciliation-widget": newReconciliationWidgetForm(t),
  "edit-reconciliation-widget": editReconciliationWidgetForm(t, {
    widgetId: "",
    accountId: "",
    partnerId: "",
    mode: "bank",
    moveLineIds: "",
    toCheck: false,
  }),
  "new-consolidation-account": newConsolidationAccountForm(t),
  "new-consolidation-journal": newConsolidationJournalForm(t),
  "new-elimination-entry": newEliminationEntryForm(t),
})

// ── Consolidation forms ───────────────────────────────────────────────────────

export const newConsolidationAccountForm = (t: TFunction): FormConfig => ({
  id: "new-consolidation-account",
  title: t("accounting.consolidation.forms.newAccount.title"),
  description: t("accounting.consolidation.forms.newAccount.description"),
  submitLabel: t("common.create"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.consolidation.forms.newAccount.fields.name"),
          required: true,
          width: "1/2",
        },
        {
          id: "code",
          name: "code",
          type: "text",
          label: t("accounting.consolidation.forms.newAccount.fields.code"),
          required: true,
          width: "1/2",
        },
        {
          id: "accountType",
          name: "accountType",
          type: "select",
          label: t("accounting.consolidation.forms.newAccount.fields.accountType"),
          required: true,
          width: "1/2",
          options: [
            { value: "asset", label: t("accounting.consolidation.accountTypes.asset") },
            { value: "liability", label: t("accounting.consolidation.accountTypes.liability") },
            { value: "equity", label: t("accounting.consolidation.accountTypes.equity") },
            { value: "income", label: t("accounting.consolidation.accountTypes.income") },
            { value: "expense", label: t("accounting.consolidation.accountTypes.expense") },
          ],
        },
        {
          id: "consolidationRate",
          name: "consolidationRate",
          type: "number",
          label: t("accounting.consolidation.forms.newAccount.fields.consolidationRate"),
          required: true,
          width: "1/2",
          min: 0,
          max: 100,
          step: 0.01,
        },
        {
          id: "currencyId",
          name: "currencyId",
          type: "select",
          label: t("accounting.consolidation.forms.newAccount.fields.currencyId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "eliminationMethod",
          name: "eliminationMethod",
          type: "select",
          label: t("accounting.consolidation.forms.newAccount.fields.eliminationMethod"),
          width: "1/2",
          options: [
            { value: "", label: t("common.none") },
            { value: "full", label: t("accounting.consolidation.eliminationMethods.full") },
            { value: "partial", label: t("accounting.consolidation.eliminationMethods.partial") },
            { value: "proportional", label: t("accounting.consolidation.eliminationMethods.proportional") },
          ],
        },
        {
          id: "isIntercompany",
          name: "isIntercompany",
          type: "checkbox",
          label: t("accounting.consolidation.forms.newAccount.fields.isIntercompany"),
          width: "1/2",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          label: t("common.active"),
          defaultValue: true,
          width: "1/2",
        },
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("common.notes"),
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
})

export const editConsolidationAccountForm = (
  t: TFunction,
  defaults: {
    accountId: string
    name: string
    code: string
    accountType: string
    consolidationRate: number
    currencyId: string
    eliminationMethod: string
    isIntercompany: boolean
    isActive: boolean
    notes: string
  },
): FormConfig => ({
  id: "edit-consolidation-account",
  title: t("accounting.consolidation.forms.editAccount.title"),
  submitLabel: t("common.save"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      fields: [
        {
          id: "accountId",
          name: "accountId",
          type: "hidden",
          label: "",
          defaultValue: defaults.accountId,
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.consolidation.forms.newAccount.fields.name"),
          required: true,
          width: "1/2",
          defaultValue: defaults.name,
        },
        {
          id: "code",
          name: "code",
          type: "text",
          label: t("accounting.consolidation.forms.newAccount.fields.code"),
          required: true,
          width: "1/2",
          defaultValue: defaults.code,
        },
        {
          id: "accountType",
          name: "accountType",
          type: "select",
          label: t("accounting.consolidation.forms.newAccount.fields.accountType"),
          required: true,
          width: "1/2",
          defaultValue: defaults.accountType,
          options: [
            { value: "asset", label: t("accounting.consolidation.accountTypes.asset") },
            { value: "liability", label: t("accounting.consolidation.accountTypes.liability") },
            { value: "equity", label: t("accounting.consolidation.accountTypes.equity") },
            { value: "income", label: t("accounting.consolidation.accountTypes.income") },
            { value: "expense", label: t("accounting.consolidation.accountTypes.expense") },
          ],
        },
        {
          id: "consolidationRate",
          name: "consolidationRate",
          type: "number",
          label: t("accounting.consolidation.forms.newAccount.fields.consolidationRate"),
          required: true,
          width: "1/2",
          defaultValue: defaults.consolidationRate,
          min: 0,
          max: 100,
          step: 0.01,
        },
        {
          id: "eliminationMethod",
          name: "eliminationMethod",
          type: "select",
          label: t("accounting.consolidation.forms.newAccount.fields.eliminationMethod"),
          width: "1/2",
          defaultValue: defaults.eliminationMethod,
          options: [
            { value: "", label: t("common.none") },
            { value: "full", label: t("accounting.consolidation.eliminationMethods.full") },
            { value: "partial", label: t("accounting.consolidation.eliminationMethods.partial") },
            { value: "proportional", label: t("accounting.consolidation.eliminationMethods.proportional") },
          ],
        },
        {
          id: "isIntercompany",
          name: "isIntercompany",
          type: "checkbox",
          label: t("accounting.consolidation.forms.newAccount.fields.isIntercompany"),
          width: "1/2",
          defaultValue: defaults.isIntercompany,
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          label: t("common.active"),
          width: "1/2",
          defaultValue: defaults.isActive,
        },
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("common.notes"),
          width: "full",
          rows: 2,
          defaultValue: defaults.notes,
        },
      ],
    },
  ],
})

export const newConsolidationJournalForm = (t: TFunction): FormConfig => ({
  id: "new-consolidation-journal",
  title: t("accounting.consolidation.forms.newJournal.title"),
  description: t("accounting.consolidation.forms.newJournal.description"),
  submitLabel: t("common.create"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.consolidation.forms.newJournal.fields.name"),
          required: true,
          width: "1/2",
        },
        {
          id: "periodName",
          name: "periodName",
          type: "text",
          label: t("accounting.consolidation.forms.newJournal.fields.periodName"),
          required: true,
          width: "1/2",
        },
        {
          id: "dateFrom",
          name: "dateFrom",
          type: "date",
          label: t("accounting.consolidation.forms.newJournal.fields.dateFrom"),
          required: true,
          width: "1/2",
        },
        {
          id: "dateTo",
          name: "dateTo",
          type: "date",
          label: t("accounting.consolidation.forms.newJournal.fields.dateTo"),
          required: true,
          width: "1/2",
        },
        {
          id: "currencyId",
          name: "currencyId",
          type: "select",
          label: t("accounting.consolidation.forms.newJournal.fields.currencyId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "exchangeRate",
          name: "exchangeRate",
          type: "number",
          label: t("accounting.consolidation.forms.newJournal.fields.exchangeRate"),
          required: true,
          width: "1/2",
          min: 0,
          step: 0.0001,
        },
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("common.notes"),
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
})

export const newEliminationEntryForm = (t: TFunction): FormConfig => ({
  id: "new-elimination-entry",
  title: t("accounting.consolidation.forms.newElimination.title"),
  description: t("accounting.consolidation.forms.newElimination.description"),
  submitLabel: t("common.create"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      fields: [
        {
          id: "journalId",
          name: "journalId",
          type: "select",
          label: t("accounting.consolidation.forms.newElimination.fields.journalId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("accounting.consolidation.forms.newElimination.fields.name"),
          required: true,
          width: "1/2",
        },
        {
          id: "accountId",
          name: "accountId",
          type: "select",
          label: t("accounting.consolidation.forms.newElimination.fields.accountId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "accountCode",
          name: "accountCode",
          type: "text",
          label: t("accounting.consolidation.forms.newElimination.fields.accountCode"),
          required: true,
          width: "1/4",
        },
        {
          id: "accountName",
          name: "accountName",
          type: "text",
          label: t("accounting.consolidation.forms.newElimination.fields.accountName"),
          required: true,
          width: "1/4",
        },
        {
          id: "companyId",
          name: "companyId",
          type: "select",
          label: t("accounting.consolidation.forms.newElimination.fields.companyId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "debit",
          name: "debit",
          type: "number",
          label: t("accounting.consolidation.forms.newElimination.fields.debit"),
          required: true,
          width: "1/4",
          min: 0,
          step: 0.01,
        },
        {
          id: "credit",
          name: "credit",
          type: "number",
          label: t("accounting.consolidation.forms.newElimination.fields.credit"),
          required: true,
          width: "1/4",
          min: 0,
          step: 0.01,
        },
        {
          id: "currencyId",
          name: "currencyId",
          type: "select",
          label: t("accounting.consolidation.forms.newElimination.fields.currencyId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "eliminationType",
          name: "eliminationType",
          type: "select",
          label: t("accounting.consolidation.forms.newElimination.fields.eliminationType"),
          required: true,
          width: "1/2",
          options: [
            { value: "intercompany", label: t("accounting.consolidation.eliminationTypes.intercompany") },
            { value: "investment", label: t("accounting.consolidation.eliminationTypes.investment") },
            { value: "dividend", label: t("accounting.consolidation.eliminationTypes.dividend") },
            { value: "profit", label: t("accounting.consolidation.eliminationTypes.profit") },
            { value: "other", label: t("accounting.consolidation.eliminationTypes.other") },
          ],
        },
        {
          id: "reference",
          name: "reference",
          type: "text",
          label: t("accounting.consolidation.forms.newElimination.fields.reference"),
          width: "full",
        },
      ],
    },
  ],
})

const fiscalYearFormFields = (t: TFunction) =>
  [
    {
      id: "name",
      name: "name",
      type: "text" as const,
      label: t("accounting.forms.fiscalYear.fields.name"),
      placeholder: t("accounting.forms.fiscalYear.fields.namePlaceholder"),
      required: true,
      width: "full" as const,
    },
    {
      id: "dateFrom",
      name: "dateFrom",
      type: "datetime" as const,
      label: t("accounting.forms.fiscalYear.fields.dateFrom"),
      required: true,
      width: "1/2" as const,
    },
    {
      id: "dateTo",
      name: "dateTo",
      type: "datetime" as const,
      label: t("accounting.forms.fiscalYear.fields.dateTo"),
      required: true,
      width: "1/2" as const,
    },
    {
      id: "fiscalYearType",
      name: "fiscalYearType",
      type: "select" as const,
      label: t("accounting.forms.fiscalYear.fields.fiscalYearType"),
      required: true,
      width: "1/2" as const,
      options: [
        { value: "standard", label: "Standard" },
        { value: "adjustment", label: "Adjustment" },
        { value: "opening", label: "Opening" },
        { value: "closing", label: "Closing" },
      ],
    },
    {
      id: "isAdjustment",
      name: "isAdjustment",
      type: "checkbox" as const,
      label: t("accounting.forms.fiscalYear.fields.isAdjustment"),
      width: "1/2" as const,
    },
    {
      id: "notes",
      name: "notes",
      type: "textarea" as const,
      label: t("accounting.forms.fiscalYear.fields.notes"),
      placeholder: t("accounting.forms.fiscalYear.fields.notesPlaceholder"),
      width: "full" as const,
      rows: 2,
    },
  ] as const

export const newFiscalYearForm = (t: TFunction): FormConfig => ({
  id: "new-fiscal-year",
  title: t("accounting.forms.fiscalYear.title"),
  description: t("accounting.forms.fiscalYear.description"),
  submitLabel: t("accounting.forms.fiscalYear.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.fiscalYear.sections.main"),
      fields: [...fiscalYearFormFields(t)],
    },
  ],
})

export const editFiscalYearForm = (t: TFunction): FormConfig => ({
  id: "edit-fiscal-year",
  title: t("accounting.forms.fiscalYear.editTitle"),
  description: t("accounting.forms.fiscalYear.description"),
  submitLabel: t("accounting.forms.fiscalYear.submitEditLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.fiscalYear.sections.main"),
      fields: [
        {
          id: "fiscalYearId",
          name: "fiscalYearId",
          type: "hidden",
          defaultValue: "",
        },
        ...fiscalYearFormFields(t),
      ],
    },
  ],
})

const accountPeriodFormFields = (t: TFunction): FormField[] => [
  {
    id: "name",
    name: "name",
    type: "text",
    label: t("accounting.forms.accountPeriod.fields.name"),
    placeholder: t("accounting.forms.accountPeriod.fields.namePlaceholder"),
    required: true,
    width: "full",
  },
  {
    id: "code",
    name: "code",
    type: "text",
    label: t("accounting.forms.accountPeriod.fields.code"),
    placeholder: t("accounting.forms.accountPeriod.fields.codePlaceholder"),
    required: true,
    width: "1/2",
  },
  {
    id: "fiscalYearId",
    name: "fiscalYearId",
    type: "select",
    label: t("accounting.forms.accountPeriod.fields.fiscalYearId"),
    required: true,
    width: "1/2",
    options: [{ value: "", label: t("accounting.forms.accountPeriod.fields.fiscalYearPlaceholder"), disabled: true }],
  },
  {
    id: "dateFrom",
    name: "dateFrom",
    type: "datetime",
    label: t("accounting.forms.accountPeriod.fields.dateFrom"),
    required: true,
    width: "1/2",
  },
  {
    id: "dateTo",
    name: "dateTo",
    type: "datetime",
    label: t("accounting.forms.accountPeriod.fields.dateTo"),
    required: true,
    width: "1/2",
  },
  {
    id: "isAdjustment",
    name: "isAdjustment",
    type: "checkbox",
    label: t("accounting.forms.accountPeriod.fields.isAdjustment"),
    width: "full",
  },
  {
    id: "notes",
    name: "notes",
    type: "textarea",
    label: t("accounting.forms.accountPeriod.fields.notes"),
    placeholder: t("accounting.forms.accountPeriod.fields.notesPlaceholder"),
    width: "full",
    rows: 2,
  },
]

export const newAccountPeriodForm = (t: TFunction): FormConfig => ({
  id: "new-account-period",
  title: t("accounting.forms.accountPeriod.title"),
  description: t("accounting.forms.accountPeriod.description"),
  submitLabel: t("accounting.forms.accountPeriod.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.accountPeriod.sections.main"),
      fields: accountPeriodFormFields(t),
    },
  ],
})

export const editAccountPeriodForm = (t: TFunction): FormConfig => ({
  id: "edit-account-period",
  title: t("accounting.forms.accountPeriod.editTitle"),
  description: t("accounting.forms.accountPeriod.editDescription"),
  submitLabel: t("accounting.forms.accountPeriod.submitEditLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.forms.accountPeriod.sections.main"),
      fields: [
        {
          id: "accountPeriodId",
          name: "accountPeriodId",
          type: "hidden",
          defaultValue: "",
        },
        ...accountPeriodFormFields(t).filter((f) => f.name !== "fiscalYearId"),
      ],
    },
  ],
})

export const runFxRevaluationForm = (t: TFunction): FormConfig => ({
  id: "run-fx-revaluation",
  title: t("accounting.fxRevaluation.form.title"),
  description: t("accounting.fxRevaluation.form.description"),
  submitLabel: t("accounting.fxRevaluation.form.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.fxRevaluation.form.sections.main"),
      fields: [
        {
          id: "currencyId",
          name: "currencyId",
          type: "select",
          label: t("accounting.fxRevaluation.form.fields.currencyId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "asOfDate",
          name: "asOfDate",
          type: "datetime",
          label: t("accounting.fxRevaluation.form.fields.asOfDate"),
          required: true,
          width: "1/2",
        },
        {
          id: "rate",
          name: "rate",
          type: "number",
          label: t("accounting.fxRevaluation.batchForm.fields.rate"),
          required: true,
          width: "1/2",
        },
        {
          id: "rateSource",
          name: "rateSource",
          type: "text",
          label: t("accounting.fxRevaluation.form.fields.rateSource"),
          required: true,
          width: "1/2",
        },
        {
          id: "rateEffectiveDate",
          name: "rateEffectiveDate",
          type: "datetime",
          label: t("accounting.fxRevaluation.form.fields.rateEffectiveDate"),
          required: true,
          width: "1/2",
        },
        {
          id: "journalId",
          name: "journalId",
          type: "select",
          label: t("accounting.fxRevaluation.form.fields.journalId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "accountId",
          name: "accountId",
          type: "select",
          label: t("accounting.fxRevaluation.form.fields.accountId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "adjustment",
          name: "adjustment",
          type: "number",
          label: t("accounting.fxRevaluation.form.fields.adjustment"),
          required: true,
          width: "1/2",
        },
        {
          id: "gainAccountId",
          name: "gainAccountId",
          type: "select",
          label: t("accounting.fxRevaluation.form.fields.gainAccountId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "lossAccountId",
          name: "lossAccountId",
          type: "select",
          label: t("accounting.fxRevaluation.form.fields.lossAccountId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "reference",
          name: "reference",
          type: "text",
          label: t("accounting.fxRevaluation.form.fields.reference"),
          width: "full",
        },
      ],
    },
  ],
})

export const runFxRevaluationBatchForm = (t: TFunction): FormConfig => ({
  id: "run-fx-revaluation-batch",
  title: t("accounting.fxRevaluation.batchForm.title"),
  description: t("accounting.fxRevaluation.batchForm.description"),
  submitLabel: t("accounting.fxRevaluation.batchForm.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.fxRevaluation.batchForm.sections.main"),
      fields: [
        {
          id: "currencyId",
          name: "currencyId",
          type: "select",
          label: t("accounting.fxRevaluation.form.fields.currencyId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "asOfDate",
          name: "asOfDate",
          type: "datetime",
          label: t("accounting.fxRevaluation.form.fields.asOfDate"),
          required: true,
          width: "1/2",
        },
        {
          id: "rate",
          name: "rate",
          type: "number",
          label: t("accounting.fxRevaluation.batchForm.fields.rate"),
          required: true,
          width: "1/2",
        },
        {
          id: "rateSource",
          name: "rateSource",
          type: "text",
          label: t("accounting.fxRevaluation.form.fields.rateSource"),
          required: true,
          width: "1/2",
        },
        {
          id: "rateEffectiveDate",
          name: "rateEffectiveDate",
          type: "datetime",
          label: t("accounting.fxRevaluation.form.fields.rateEffectiveDate"),
          required: true,
          width: "1/2",
        },
        {
          id: "journalId",
          name: "journalId",
          type: "select",
          label: t("accounting.fxRevaluation.form.fields.journalId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "gainAccountId",
          name: "gainAccountId",
          type: "select",
          label: t("accounting.fxRevaluation.form.fields.gainAccountId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "lossAccountId",
          name: "lossAccountId",
          type: "select",
          label: t("accounting.fxRevaluation.form.fields.lossAccountId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "reference",
          name: "reference",
          type: "text",
          label: t("accounting.fxRevaluation.form.fields.reference"),
          width: "full",
        },
      ],
    },
  ],
})

export const postRealizedFxForm = (t: TFunction): FormConfig => ({
  id: "post-realized-fx",
  title: t("accounting.fxRevaluation.realizedForm.title"),
  description: t("accounting.fxRevaluation.realizedForm.description"),
  submitLabel: t("accounting.fxRevaluation.realizedForm.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.fxRevaluation.realizedForm.sections.main"),
      fields: [
        {
          id: "paymentId",
          name: "paymentId",
          type: "select",
          label: t("accounting.fxRevaluation.realizedForm.fields.paymentId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "invoiceMoveId",
          name: "invoiceMoveId",
          type: "select",
          label: t("accounting.fxRevaluation.realizedForm.fields.invoiceMoveId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "paymentAmountFunctional",
          name: "paymentAmountFunctional",
          type: "number",
          label: t("accounting.fxRevaluation.realizedForm.fields.paymentAmountFunctional"),
          required: true,
          width: "1/2",
        },
        {
          id: "invoiceResidualFunctional",
          name: "invoiceResidualFunctional",
          type: "number",
          label: t("accounting.fxRevaluation.realizedForm.fields.invoiceResidualFunctional"),
          required: true,
          width: "1/2",
        },
        {
          id: "journalId",
          name: "journalId",
          type: "select",
          label: t("accounting.fxRevaluation.form.fields.journalId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "clearingAccountId",
          name: "clearingAccountId",
          type: "select",
          label: t("accounting.fxRevaluation.realizedForm.fields.clearingAccountId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "gainAccountId",
          name: "gainAccountId",
          type: "select",
          label: t("accounting.fxRevaluation.form.fields.gainAccountId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "lossAccountId",
          name: "lossAccountId",
          type: "select",
          label: t("accounting.fxRevaluation.form.fields.lossAccountId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "date",
          name: "date",
          type: "datetime",
          label: t("accounting.fxRevaluation.realizedForm.fields.date"),
          required: true,
          width: "1/2",
        },
        {
          id: "reference",
          name: "reference",
          type: "text",
          label: t("accounting.fxRevaluation.form.fields.reference"),
          width: "full",
        },
      ],
    },
  ],
})

export const upsertPartnerCreditControlForm = (t: TFunction): FormConfig => ({
  id: "upsert-partner-credit-control",
  title: t("accounting.creditControl.form.title"),
  description: t("accounting.creditControl.form.description"),
  submitLabel: t("accounting.creditControl.form.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.creditControl.form.sections.main"),
      fields: [
        {
          id: "partnerId",
          name: "partnerId",
          type: "select",
          label: t("accounting.creditControl.form.fields.partnerId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "creditLimit",
          name: "creditLimit",
          type: "number",
          label: t("accounting.creditControl.form.fields.creditLimit"),
          required: true,
          width: "1/2",
        },
        {
          id: "paymentHold",
          name: "paymentHold",
          type: "checkbox",
          label: t("accounting.creditControl.form.fields.paymentHold"),
          width: "1/2",
          defaultValue: false,
        },
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("accounting.creditControl.form.fields.notes"),
          width: "full",
        },
      ],
    },
  ],
})

export const createBadDebtWriteOffForm = (t: TFunction): FormConfig => ({
  id: "create-bad-debt-write-off",
  title: t("accounting.creditControl.writeOffForm.title"),
  description: t("accounting.creditControl.writeOffForm.description"),
  submitLabel: t("accounting.creditControl.writeOffForm.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.creditControl.writeOffForm.sections.main"),
      fields: [
        {
          id: "partnerId",
          name: "partnerId",
          type: "select",
          label: t("accounting.creditControl.form.fields.partnerId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "moveId",
          name: "moveId",
          type: "select",
          label: t("accounting.creditControl.writeOffForm.fields.moveId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "amount",
          name: "amount",
          type: "number",
          label: t("accounting.creditControl.writeOffForm.fields.amount"),
          required: true,
          width: "1/2",
        },
        {
          id: "journalId",
          name: "journalId",
          type: "select",
          label: t("accounting.fxRevaluation.form.fields.journalId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "receivableAccountId",
          name: "receivableAccountId",
          type: "select",
          label: t("accounting.creditControl.writeOffForm.fields.receivableAccountId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "writeOffAccountId",
          name: "writeOffAccountId",
          type: "select",
          label: t("accounting.creditControl.writeOffForm.fields.writeOffAccountId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "date",
          name: "date",
          type: "datetime",
          label: t("accounting.creditControl.writeOffForm.fields.date"),
          required: true,
          width: "1/2",
        },
        {
          id: "reference",
          name: "reference",
          type: "text",
          label: t("accounting.fxRevaluation.form.fields.reference"),
          width: "full",
        },
      ],
    },
  ],
})

export const createAmortizationScheduleForm = (t: TFunction): FormConfig => ({
  id: "create-amortization-schedule",
  title: t("accounting.amortization.form.title"),
  description: t("accounting.amortization.form.description"),
  submitLabel: t("accounting.amortization.form.submitLabel"),
  cancelLabel: t("common.cancel"),
  sections: [
    {
      id: "main",
      title: t("accounting.amortization.form.sections.main"),
      fields: [
        {
          id: "scheduleKind",
          name: "scheduleKind",
          type: "select",
          label: t("accounting.amortization.form.fields.scheduleKind"),
          required: true,
          width: "1/2",
          options: [
            { value: "accrual", label: t("accounting.amortization.kind.accrual") },
            { value: "prepaid", label: t("accounting.amortization.kind.prepaid") },
          ],
          defaultValue: "prepaid",
        },
        {
          id: "recognitionPeriod",
          name: "recognitionPeriod",
          type: "select",
          label: t("accounting.amortization.form.fields.recognitionPeriod"),
          required: true,
          width: "1/2",
          options: [
            { value: "month", label: t("accounting.amortization.period.month") },
            { value: "quarter", label: t("accounting.amortization.period.quarter") },
            { value: "year", label: t("accounting.amortization.period.year") },
          ],
          defaultValue: "month",
        },
        {
          id: "description",
          name: "description",
          type: "text",
          label: t("accounting.amortization.form.fields.description"),
          required: true,
          width: "full",
        },
        {
          id: "totalAmount",
          name: "totalAmount",
          type: "number",
          label: t("accounting.amortization.form.fields.totalAmount"),
          required: true,
          width: "1/2",
        },
        {
          id: "currencyId",
          name: "currencyId",
          type: "select",
          label: t("accounting.amortization.form.fields.currencyId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "journalId",
          name: "journalId",
          type: "select",
          label: t("accounting.fxRevaluation.form.fields.journalId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "balanceSheetAccountId",
          name: "balanceSheetAccountId",
          type: "select",
          label: t("accounting.amortization.form.fields.balanceSheetAccountId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "plAccountId",
          name: "plAccountId",
          type: "select",
          label: t("accounting.amortization.form.fields.plAccountId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "startDate",
          name: "startDate",
          type: "datetime",
          label: t("accounting.amortization.form.fields.startDate"),
          required: true,
          width: "1/2",
        },
        {
          id: "endDate",
          name: "endDate",
          type: "datetime",
          label: t("accounting.amortization.form.fields.endDate"),
          required: true,
          width: "1/2",
        },
      ],
    },
  ],
})
