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

export const editExpenseForm = (t: TFunction): FormConfig => ({
  id: "edit-expense",
  title: t("expenses.forms.editExpense.title"),
  description: t("expenses.forms.editExpense.description"),
  sections: [
    {
      id: "edit-expense-details",
      title: t("expenses.forms.editExpense.sections.details"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("expenses.forms.editExpense.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "unitAmount",
          name: "unitAmount",
          type: "number",
          label: t("expenses.forms.editExpense.fields.unitAmount"),
          placeholder: "0.00",
          required: true,
          width: "1/2",
        },
        {
          id: "quantity",
          name: "quantity",
          type: "number",
          label: t("expenses.forms.editExpense.fields.quantity"),
          placeholder: "1",
          required: true,
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("expenses.forms.editExpense.fields.description"),
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
})

export const addExpenseToReportForm = (t: TFunction): FormConfig => ({
  id: "add-expense-to-report",
  title: t("expenses.forms.addToReport.title"),
  description: t("expenses.forms.addToReport.description"),
  sections: [
    {
      id: "sheet-pick",
      title: t("expenses.forms.addToReport.sections.sheet"),
      fields: [
        {
          id: "sheetId",
          name: "sheetId",
          type: "select",
          label: t("expenses.forms.addToReport.fields.sheetId"),
          placeholder: t("expenses.forms.addToReport.fields.sheetPlaceholder"),
          required: true,
          width: "full",
          options: emptySelect,
        },
      ],
    },
  ],
})

export const submitExpenseReportForm = (t: TFunction): FormConfig => ({
  id: "submit-expense-report",
  title: t("expenses.forms.submitReport.title"),
  description: t("expenses.forms.submitReport.description"),
  sections: [
    {
      id: "submit-totals",
      title: t("expenses.forms.submitReport.sections.totals"),
      fields: [
        {
          id: "totalAmount",
          name: "totalAmount",
          type: "number",
          label: t("expenses.forms.submitReport.fields.totalAmount"),
          placeholder: "0.00",
          required: true,
          width: "full",
        },
      ],
    },
  ],
})

export const postExpenseReportForm = (t: TFunction): FormConfig => ({
  id: "post-expense-report",
  title: t("expenses.forms.postReport.title"),
  description: t("expenses.forms.postReport.description"),
  sections: [
    {
      id: "post-date",
      title: t("expenses.forms.postReport.sections.date"),
      fields: [
        {
          id: "accountingDate",
          name: "accountingDate",
          type: "date",
          label: t("expenses.forms.postReport.fields.accountingDate"),
          required: true,
          width: "full",
        },
      ],
    },
  ],
})

export const expensesFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-expense": newExpenseForm(t),
  "new-expense-sheet": newExpenseSheetForm(t),
  "edit-expense": editExpenseForm(t),
  "add-expense-to-report": addExpenseToReportForm(t),
  "submit-expense-report": submitExpenseReportForm(t),
  "post-expense-report": postExpenseReportForm(t),
})
