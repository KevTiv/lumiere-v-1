import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

const emptySelect: Array<{ value: string; label: string; disabled?: boolean }> = []

export const newExpenseForm = (t: TFunction): FormConfig => ({
  id: "new-expense",
  title: t("expenses.forms.newExpense.title"),
  description: t("expenses.forms.newExpense.description"),
  sections: [
    {
      id: "expense-details",
      title: t("expenses.forms.newExpense.sections.expenseDetails"),
      fields: [
        {
          id: "pricelistId",
          name: "pricelistId",
          type: "select",
          label: t("expenses.forms.newExpense.fields.pricelistId"),
          placeholder: t("expenses.forms.newExpense.fields.pricelistPlaceholder"),
          required: true,
          width: "full",
          options: emptySelect,
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("expenses.forms.newExpense.fields.name"),
          placeholder: t("expenses.forms.newExpense.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "totalAmount",
          name: "totalAmount",
          type: "number",
          label: t("expenses.forms.newExpense.fields.totalAmount"),
          placeholder: "0.00",
          required: true,
          width: "1/2",
        },
        {
          id: "date",
          name: "date",
          type: "date",
          label: t("expenses.forms.newExpense.fields.date"),
          required: true,
          width: "1/2",
        },
        {
          id: "employeeId",
          name: "employeeId",
          type: "select",
          label: t("expenses.forms.newExpense.fields.employeeId"),
          placeholder: t("expenses.forms.newExpense.fields.employeePlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "quantity",
          name: "quantity",
          type: "number",
          label: t("expenses.forms.newExpense.fields.quantity"),
          placeholder: "1",
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("expenses.forms.newExpense.fields.description"),
          placeholder: t("expenses.forms.newExpense.fields.descriptionPlaceholder"),
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
})

export const newExpenseSheetForm = (t: TFunction): FormConfig => ({
  id: "new-expense-sheet",
  title: t("expenses.forms.newExpenseReport.title"),
  description: t("expenses.forms.newExpenseReport.description"),
  sections: [
    {
      id: "sheet-info",
      title: t("expenses.forms.newExpenseReport.sections.reportDetails"),
      fields: [
        {
          id: "pricelistId",
          name: "pricelistId",
          type: "select",
          label: t("expenses.forms.newExpenseReport.fields.pricelistId"),
          placeholder: t("expenses.forms.newExpenseReport.fields.pricelistPlaceholder"),
          required: true,
          width: "full",
          options: emptySelect,
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("expenses.forms.newExpenseReport.fields.name"),
          placeholder: t("expenses.forms.newExpenseReport.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "employeeId",
          name: "employeeId",
          type: "select",
          label: t("expenses.forms.newExpenseReport.fields.employeeId"),
          placeholder: t("expenses.forms.newExpenseReport.fields.employeePlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "accountingDate",
          name: "accountingDate",
          type: "date",
          label: t("expenses.forms.newExpenseReport.fields.accountingDate"),
          width: "1/2",
        },
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("expenses.forms.newExpenseReport.fields.notes"),
          placeholder: t("expenses.forms.newExpenseReport.fields.notesPlaceholder"),
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
})

export const expensesFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-expense": newExpenseForm(t),
  "new-expense-sheet": newExpenseSheetForm(t),
})
