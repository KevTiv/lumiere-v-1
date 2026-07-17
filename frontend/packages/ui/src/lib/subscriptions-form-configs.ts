import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

const emptySelect: Array<{ value: string; label: string; disabled?: boolean }> = []

export const newSubscriptionForm = (t: TFunction): FormConfig => ({
  id: "new-subscription",
  title: t("subscriptions.forms.newSubscription.title"),
  description: t("subscriptions.forms.newSubscription.description"),
  sections: [
    {
      id: "sub-details",
      title: t("subscriptions.forms.newSubscription.sections.subscriptionDetails"),
      fields: [
        {
          id: "saleOrderId",
          name: "saleOrderId",
          type: "select",
          label: t("subscriptions.forms.newSubscription.fields.saleOrderId"),
          placeholder: t("subscriptions.forms.newSubscription.fields.saleOrderPlaceholder"),
          required: true,
          width: "full",
          options: emptySelect,
        },
        {
          id: "planId",
          name: "planId",
          type: "select",
          label: t("subscriptions.forms.newSubscription.fields.planId"),
          placeholder: t("subscriptions.forms.newSubscription.fields.planPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "code",
          name: "code",
          type: "text",
          label: t("subscriptions.forms.newSubscription.fields.code"),
          placeholder: t("subscriptions.forms.newSubscription.fields.codePlaceholder"),
          width: "1/2",
        },
        {
          id: "dateStart",
          name: "dateStart",
          type: "date",
          label: t("subscriptions.forms.newSubscription.fields.dateStart"),
          required: true,
          width: "1/2",
        },
        {
          id: "paymentMode",
          name: "paymentMode",
          type: "select",
          label: t("subscriptions.forms.newSubscription.fields.paymentMode"),
          width: "1/2",
          options: [
            { value: "manual", label: t("subscriptions.forms.newSubscription.fields.options.manual") },
            { value: "automatic", label: t("subscriptions.forms.newSubscription.fields.options.automatic") },
          ],
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("subscriptions.forms.newSubscription.fields.description"),
          placeholder: t("subscriptions.forms.newSubscription.fields.descriptionPlaceholder"),
          width: "full",
          rows: 2,
        },
      ],
    },
    {
      id: "sub-billing",
      title: t("subscriptions.forms.newSubscription.sections.billing"),
      fields: [
        {
          id: "recurringInvoiceDay",
          name: "recurringInvoiceDay",
          type: "number",
          label: t("subscriptions.forms.newSubscription.fields.recurringInvoiceDay"),
          placeholder: "1",
          width: "1/2",
        },
        {
          id: "isTrial",
          name: "isTrial",
          type: "checkbox",
          label: t("subscriptions.forms.newSubscription.fields.isTrial"),
          width: "1/2",
        },
        {
          id: "recurringRuleType",
          name: "recurringRuleType",
          type: "select",
          label: t("subscriptions.forms.newSubscription.fields.recurringRuleType"),
          width: "1/2",
          options: [
            { value: "daily", label: t("subscriptions.forms.newSubscription.fields.options.recurring.daily") },
            { value: "weekly", label: t("subscriptions.forms.newSubscription.fields.options.recurring.weekly") },
            { value: "monthly", label: t("subscriptions.forms.newSubscription.fields.options.recurring.monthly") },
            { value: "yearly", label: t("subscriptions.forms.newSubscription.fields.options.recurring.yearly") },
          ],
        },
        {
          id: "recurringInterval",
          name: "recurringInterval",
          type: "number",
          label: t("subscriptions.forms.newSubscription.fields.recurringInterval"),
          placeholder: "1",
          width: "1/2",
        },
        {
          id: "state",
          name: "state",
          type: "select",
          label: t("subscriptions.forms.newSubscription.fields.state"),
          width: "1/2",
          options: [
            { value: "draft", label: t("subscriptions.forms.newSubscription.fields.options.state.draft") },
            { value: "open", label: t("subscriptions.forms.newSubscription.fields.options.state.open") },
            { value: "pending", label: t("subscriptions.forms.newSubscription.fields.options.state.pending") },
          ],
        },
        {
          id: "health",
          name: "health",
          type: "select",
          label: t("subscriptions.forms.newSubscription.fields.health"),
          width: "1/2",
          options: [
            { value: "normal", label: t("subscriptions.forms.newSubscription.fields.options.health.normal") },
            { value: "good", label: t("subscriptions.forms.newSubscription.fields.options.health.good") },
            { value: "bad", label: t("subscriptions.forms.newSubscription.fields.options.health.bad") },
          ],
        },
      ],
    },
  ],
})

export const newSubscriptionPlanForm = (t: TFunction): FormConfig => ({
  id: "new-subscription-plan",
  title: t("subscriptions.forms.newPlan.title"),
  description: t("subscriptions.forms.newPlan.description"),
  sections: [
    {
      id: "plan-details",
      title: t("subscriptions.forms.newPlan.sections.planDetails"),
      fields: [
        {
          id: "pricelistId",
          name: "pricelistId",
          type: "select",
          label: t("subscriptions.forms.newPlan.fields.pricelistId"),
          placeholder: t("subscriptions.forms.newPlan.fields.pricelistPlaceholder"),
          required: true,
          width: "full",
          options: emptySelect,
        },
        {
          id: "journalId",
          name: "journalId",
          type: "select",
          label: t("subscriptions.forms.newPlan.fields.journalId"),
          placeholder: t("subscriptions.forms.newPlan.fields.journalPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "productId",
          name: "productId",
          type: "select",
          label: t("subscriptions.forms.newPlan.fields.productId"),
          placeholder: t("subscriptions.forms.newPlan.fields.productPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("subscriptions.forms.newPlan.fields.name"),
          placeholder: t("subscriptions.forms.newPlan.fields.namePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "code",
          name: "code",
          type: "text",
          label: t("subscriptions.forms.newPlan.fields.code"),
          placeholder: t("subscriptions.forms.newPlan.fields.codePlaceholder"),
          width: "1/2",
        },
        {
          id: "billingPeriod",
          name: "billingPeriod",
          type: "select",
          label: t("subscriptions.forms.newPlan.fields.billingPeriod"),
          width: "1/2",
          options: [
            { value: "monthly", label: t("subscriptions.forms.newPlan.fields.options.monthly") },
            { value: "quarterly", label: t("subscriptions.forms.newPlan.fields.options.quarterly") },
            { value: "yearly", label: t("subscriptions.forms.newPlan.fields.options.yearly") },
          ],
        },
        {
          id: "billingPeriodUnit",
          name: "billingPeriodUnit",
          type: "number",
          label: t("subscriptions.forms.newPlan.fields.billingPeriodUnit"),
          placeholder: "1",
          width: "1/2",
        },
        {
          id: "trialPeriod",
          name: "trialPeriod",
          type: "checkbox",
          label: t("subscriptions.forms.newPlan.fields.trialPeriod"),
          width: "1/2",
        },
        {
          id: "trialDuration",
          name: "trialDuration",
          type: "number",
          label: t("subscriptions.forms.newPlan.fields.trialDuration"),
          placeholder: t("subscriptions.forms.newPlan.fields.trialDurationPlaceholder"),
          width: "1/2",
        },
        {
          id: "isDefault",
          name: "isDefault",
          type: "checkbox",
          label: t("subscriptions.forms.newPlan.fields.isDefault"),
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("subscriptions.forms.newPlan.fields.description"),
          placeholder: t("subscriptions.forms.newPlan.fields.descriptionPlaceholder"),
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
})

export const newDeferredRevenueScheduleForm = (t: TFunction): FormConfig => ({
  id: "new-deferred-revenue-schedule",
  title: t("subscriptions.forms.deferredSchedule.title"),
  description: t("subscriptions.forms.deferredSchedule.description"),
  sections: [
    {
      id: "drs-main",
      title: t("subscriptions.forms.deferredSchedule.sections.main"),
      fields: [
        {
          id: "description",
          name: "description",
          type: "text",
          label: t("subscriptions.forms.deferredSchedule.fields.description"),
          required: true,
          width: "full",
        },
        {
          id: "journalId",
          name: "journalId",
          type: "select",
          label: t("subscriptions.forms.deferredSchedule.fields.journalId"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "accountId",
          name: "accountId",
          type: "select",
          label: t("subscriptions.forms.deferredSchedule.fields.revenueAccountId"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "deferredAccountId",
          name: "deferredAccountId",
          type: "select",
          label: t("subscriptions.forms.deferredSchedule.fields.deferredAccountId"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "currencyId",
          name: "currencyId",
          type: "select",
          label: t("subscriptions.forms.deferredSchedule.fields.currencyId"),
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "totalAmount",
          name: "totalAmount",
          type: "number",
          label: t("subscriptions.forms.deferredSchedule.fields.totalAmount"),
          required: true,
          width: "1/2",
        },
        {
          id: "recognizedAmount",
          name: "recognizedAmount",
          type: "number",
          label: t("subscriptions.forms.deferredSchedule.fields.recognizedAmount"),
          placeholder: "0",
          width: "1/2",
        },
        {
          id: "startDate",
          name: "startDate",
          type: "date",
          label: t("subscriptions.forms.deferredSchedule.fields.startDate"),
          required: true,
          width: "1/2",
        },
        {
          id: "endDate",
          name: "endDate",
          type: "date",
          label: t("subscriptions.forms.deferredSchedule.fields.endDate"),
          required: true,
          width: "1/2",
        },
        {
          id: "recognitionMethod",
          name: "recognitionMethod",
          type: "select",
          label: t("subscriptions.forms.deferredSchedule.fields.recognitionMethod"),
          width: "1/2",
          options: [
            { value: "straight_line", label: t("subscriptions.forms.deferredSchedule.options.straightLine") },
            { value: "one_time", label: t("subscriptions.forms.deferredSchedule.options.oneTime") },
            { value: "monthly", label: t("subscriptions.forms.deferredSchedule.options.monthly") },
          ],
        },
        {
          id: "recognitionPeriod",
          name: "recognitionPeriod",
          type: "select",
          label: t("subscriptions.forms.deferredSchedule.fields.recognitionPeriod"),
          width: "1/2",
          options: [
            { value: "month", label: t("subscriptions.forms.deferredSchedule.options.month") },
            { value: "quarter", label: t("subscriptions.forms.deferredSchedule.options.quarter") },
            { value: "year", label: t("subscriptions.forms.deferredSchedule.options.year") },
          ],
        },
        {
          id: "state",
          name: "state",
          type: "select",
          label: t("subscriptions.forms.deferredSchedule.fields.state"),
          width: "1/2",
          options: [
            { value: "draft", label: t("subscriptions.forms.deferredSchedule.options.stateDraft") },
            { value: "running", label: t("subscriptions.forms.deferredSchedule.options.stateRunning") },
          ],
        },
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("subscriptions.forms.deferredSchedule.fields.notes"),
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
})

export const newRevenueRecognitionRuleForm = (t: TFunction): FormConfig => ({
  id: "new-revenue-recognition-rule",
  title: t("subscriptions.forms.recognitionRule.title"),
  description: t("subscriptions.forms.recognitionRule.description"),
  sections: [
    {
      id: "rr-main",
      title: t("subscriptions.forms.recognitionRule.sections.main"),
      fields: [
        {
          id: "description",
          name: "description",
          type: "text",
          label: t("subscriptions.forms.recognitionRule.fields.description"),
          required: true,
          width: "full",
        },
        {
          id: "recognitionAccountId",
          name: "recognitionAccountId",
          type: "select",
          label: t("subscriptions.forms.recognitionRule.fields.recognitionAccountId"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "deferredAccountId",
          name: "deferredAccountId",
          type: "select",
          label: t("subscriptions.forms.recognitionRule.fields.deferredAccountId"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "expenseAccountId",
          name: "expenseAccountId",
          type: "select",
          label: t("subscriptions.forms.recognitionRule.fields.expenseAccountId"),
          width: "1/2",
          options: [{ value: "", label: "—" }],
        },
        {
          id: "productCategoryIds",
          name: "productCategoryIds",
          type: "text",
          label: t("subscriptions.forms.recognitionRule.fields.productCategoryIds"),
          placeholder: t("subscriptions.forms.recognitionRule.fields.idListPlaceholder"),
          width: "full",
        },
        {
          id: "productIds",
          name: "productIds",
          type: "text",
          label: t("subscriptions.forms.recognitionRule.fields.productIds"),
          placeholder: t("subscriptions.forms.recognitionRule.fields.idListPlaceholder"),
          width: "full",
        },
        {
          id: "recognitionMethod",
          name: "recognitionMethod",
          type: "select",
          label: t("subscriptions.forms.recognitionRule.fields.recognitionMethod"),
          width: "1/2",
          options: [
            { value: "straight_line", label: t("subscriptions.forms.deferredSchedule.options.straightLine") },
            { value: "one_time", label: t("subscriptions.forms.deferredSchedule.options.oneTime") },
          ],
        },
        {
          id: "recognitionPeriod",
          name: "recognitionPeriod",
          type: "select",
          label: t("subscriptions.forms.recognitionRule.fields.recognitionPeriod"),
          width: "1/2",
          options: [
            { value: "month", label: t("subscriptions.forms.deferredSchedule.options.month") },
            { value: "quarter", label: t("subscriptions.forms.deferredSchedule.options.quarter") },
            { value: "year", label: t("subscriptions.forms.deferredSchedule.options.year") },
          ],
        },
        {
          id: "priority",
          name: "priority",
          type: "number",
          label: t("subscriptions.forms.recognitionRule.fields.priority"),
          placeholder: "10",
          width: "1/2",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          label: t("subscriptions.forms.recognitionRule.fields.isActive"),
          width: "1/2",
        },
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("subscriptions.forms.recognitionRule.fields.notes"),
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
})

export const closeSubscriptionForm = (t: TFunction): FormConfig => ({
  id: "close-subscription",
  title: t("subscriptions.forms.closeSubscription.title"),
  description: t("subscriptions.forms.closeSubscription.description"),
  sections: [
    {
      id: "cs-main",
      title: t("subscriptions.forms.closeSubscription.sections.main"),
      fields: [
        {
          id: "closeReasonId",
          name: "closeReasonId",
          type: "select",
          label: t("subscriptions.forms.closeSubscription.fields.closeReasonId"),
          placeholder: t("subscriptions.forms.closeSubscription.fields.closeReasonIdPlaceholder"),
          width: "full",
          options: [{ value: "", label: "—" }],
        },
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("subscriptions.forms.closeSubscription.fields.notes"),
          width: "full",
          rows: 3,
        },
        {
          id: "noCharge",
          name: "noCharge",
          type: "checkbox",
          label: t("subscriptions.forms.closeSubscription.fields.noCharge", {
            defaultValue: "Close without final invoice (no charge)",
          }),
          width: "full",
        },
      ],
    },
  ],
})

export const generateSubscriptionInvoiceForm = (t: TFunction): FormConfig => ({
  id: "generate-subscription-invoice",
  title: t("subscriptions.forms.generateInvoice.title"),
  description: t("subscriptions.forms.generateInvoice.description"),
  sections: [
    {
      id: "gi-main",
      title: t("subscriptions.forms.generateInvoice.sections.main"),
      fields: [
        {
          id: "invoiceDate",
          name: "invoiceDate",
          type: "date",
          label: t("subscriptions.forms.generateInvoice.fields.invoiceDate"),
          required: true,
          width: "1/2",
        },
        {
          id: "journalId",
          name: "journalId",
          type: "select",
          label: t("subscriptions.forms.generateInvoice.fields.journalId", {
            defaultValue: "Journal",
          }),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "incomeAccountId",
          name: "incomeAccountId",
          type: "select",
          label: t("subscriptions.forms.generateInvoice.fields.incomeAccountId", {
            defaultValue: "Income account",
          }),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "receivableAccountId",
          name: "receivableAccountId",
          type: "select",
          label: t("subscriptions.forms.generateInvoice.fields.receivableAccountId", {
            defaultValue: "Receivable account",
          }),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "taxAccountId",
          name: "taxAccountId",
          type: "select",
          label: t("subscriptions.forms.generateInvoice.fields.taxAccountId", {
            defaultValue: "Tax payable account (optional)",
          }),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "billingRunKey",
          name: "billingRunKey",
          type: "text",
          label: t("subscriptions.forms.generateInvoice.fields.billingRunKey", {
            defaultValue: "Billing run key (optional)",
          }),
          width: "full",
        },
      ],
    },
  ],
})

export const paySubscriptionInvoiceForm = (t: TFunction): FormConfig => ({
  id: "pay-subscription-invoice",
  title: t("subscriptions.forms.payInvoice.title", {
    defaultValue: "Apply payment",
  }),
  description: t("subscriptions.forms.payInvoice.description", {
    defaultValue: "Post the subscription invoice (if draft) and clear AR residual.",
  }),
  sections: [
    {
      id: "pay-main",
      title: t("subscriptions.forms.payInvoice.sections.main", { defaultValue: "Payment" }),
      fields: [
        {
          id: "invoiceMoveId",
          name: "invoiceMoveId",
          type: "select",
          label: t("subscriptions.forms.payInvoice.fields.invoiceMoveId", {
            defaultValue: "Invoice",
          }),
          required: true,
          width: "full",
          options: emptySelect,
        },
        {
          id: "paymentJournalId",
          name: "paymentJournalId",
          type: "select",
          label: t("subscriptions.forms.payInvoice.fields.paymentJournalId", {
            defaultValue: "Bank journal",
          }),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "bankAccountId",
          name: "bankAccountId",
          type: "select",
          label: t("subscriptions.forms.payInvoice.fields.bankAccountId", {
            defaultValue: "Bank account",
          }),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "receivableAccountId",
          name: "receivableAccountId",
          type: "select",
          label: t("subscriptions.forms.payInvoice.fields.receivableAccountId", {
            defaultValue: "Receivable account",
          }),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "amount",
          name: "amount",
          type: "number",
          label: t("subscriptions.forms.payInvoice.fields.amount", {
            defaultValue: "Amount (blank = residual)",
          }),
          width: "1/2",
        },
        {
          id: "cogsAccountId",
          name: "cogsAccountId",
          type: "select",
          label: t("subscriptions.forms.payInvoice.fields.cogsAccountId", {
            defaultValue: "COGS account (for draft post)",
          }),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "inventoryAccountId",
          name: "inventoryAccountId",
          type: "select",
          label: t("subscriptions.forms.payInvoice.fields.inventoryAccountId", {
            defaultValue: "Inventory account (for draft post)",
          }),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
      ],
    },
  ],
})

export const recognizeDeferredRevenueLineForm = (t: TFunction): FormConfig => ({
  id: "recognize-deferred-revenue-line",
  title: t("subscriptions.forms.recognizeLine.title"),
  description: t("subscriptions.forms.recognizeLine.description"),
  sections: [
    {
      id: "rl-main",
      title: t("subscriptions.forms.recognizeLine.sections.main"),
      fields: [
        {
          id: "moveId",
          name: "moveId",
          type: "select",
          label: t("subscriptions.forms.recognizeLine.fields.moveId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
        {
          id: "moveLineId",
          name: "moveLineId",
          type: "select",
          label: t("subscriptions.forms.recognizeLine.fields.moveLineId"),
          required: true,
          width: "1/2",
          options: [{ value: "", label: "—", disabled: true }],
        },
      ],
    },
  ],
})

export const importSubscriptionPlanCsvForm = (t: TFunction): FormConfig => ({
  id: "import-subscription-plan-csv",
  title: t("subscriptions.forms.importPlanCsv.title"),
  description: t("subscriptions.forms.importPlanCsv.description"),
  sections: [
    {
      id: "ipc-main",
      title: t("subscriptions.forms.importPlanCsv.sections.main"),
      fields: [
        {
          id: "csvData",
          name: "csvData",
          type: "textarea",
          label: t("subscriptions.forms.importPlanCsv.fields.csvData"),
          placeholder: t("subscriptions.forms.importPlanCsv.fields.csvPlaceholder"),
          required: true,
          width: "full",
          rows: 12,
        },
      ],
    },
  ],
})

export const importSubscriptionCsvForm = (t: TFunction): FormConfig => ({
  id: "import-subscription-csv",
  title: t("subscriptions.forms.importSubscriptionCsv.title"),
  description: t("subscriptions.forms.importSubscriptionCsv.description"),
  sections: [
    {
      id: "isc-main",
      title: t("subscriptions.forms.importSubscriptionCsv.sections.main"),
      fields: [
        {
          id: "csvData",
          name: "csvData",
          type: "textarea",
          label: t("subscriptions.forms.importSubscriptionCsv.fields.csvData"),
          placeholder: t("subscriptions.forms.importSubscriptionCsv.fields.csvPlaceholder"),
          required: true,
          width: "full",
          rows: 12,
        },
      ],
    },
  ],
})

export const amendSubscriptionForm = (t: TFunction): FormConfig => ({
  id: "amend-subscription",
  title: t("subscriptions.forms.amend.title", { defaultValue: "Amend subscription" }),
  description: t("subscriptions.forms.amend.description", {
    defaultValue: "Change price, quantity, or product with optional mid-period proration.",
  }),
  sections: [
    {
      id: "amend-main",
      title: t("subscriptions.forms.amend.sections.main", { defaultValue: "Amendment" }),
      fields: [
        {
          id: "amendmentType",
          name: "amendmentType",
          type: "select",
          label: t("subscriptions.forms.amend.fields.amendmentType", { defaultValue: "Type" }),
          required: true,
          width: "1/2",
          options: [
            { value: "price", label: "Price" },
            { value: "quantity", label: "Quantity" },
            { value: "upgrade", label: "Upgrade" },
            { value: "downgrade", label: "Downgrade" },
          ],
          defaultValue: "price",
        },
        {
          id: "lineId",
          name: "lineId",
          type: "select",
          label: t("subscriptions.forms.amend.fields.lineId", { defaultValue: "Line" }),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "newPriceUnit",
          name: "newPriceUnit",
          type: "number",
          label: t("subscriptions.forms.amend.fields.newPriceUnit", { defaultValue: "New price" }),
          width: "1/2",
        },
        {
          id: "newQuantity",
          name: "newQuantity",
          type: "number",
          label: t("subscriptions.forms.amend.fields.newQuantity", { defaultValue: "New quantity" }),
          width: "1/2",
        },
        {
          id: "prorate",
          name: "prorate",
          type: "checkbox",
          label: t("subscriptions.forms.amend.fields.prorate", {
            defaultValue: "Prorate unused period",
          }),
          defaultValue: true,
          width: "full",
        },
        {
          id: "journalId",
          name: "journalId",
          type: "select",
          label: t("subscriptions.forms.amend.fields.journalId", { defaultValue: "Journal" }),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "incomeAccountId",
          name: "incomeAccountId",
          type: "select",
          label: t("subscriptions.forms.amend.fields.incomeAccountId", {
            defaultValue: "Income account",
          }),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "receivableAccountId",
          name: "receivableAccountId",
          type: "select",
          label: t("subscriptions.forms.amend.fields.receivableAccountId", {
            defaultValue: "Receivable account",
          }),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("subscriptions.forms.amend.fields.notes", { defaultValue: "Notes" }),
          width: "full",
        },
      ],
    },
  ],
})

export const renewSubscriptionForm = (t: TFunction): FormConfig => ({
  id: "renew-subscription",
  title: t("subscriptions.forms.renew.title", { defaultValue: "Renew / extend term" }),
  description: t("subscriptions.forms.renew.description", {
    defaultValue: "Push the next invoice date forward by N billing intervals.",
  }),
  sections: [
    {
      id: "renew-main",
      title: t("subscriptions.forms.renew.sections.main", { defaultValue: "Renewal" }),
      fields: [
        {
          id: "intervals",
          name: "intervals",
          type: "number",
          label: t("subscriptions.forms.renew.fields.intervals", {
            defaultValue: "Intervals to extend",
          }),
          required: true,
          defaultValue: 1,
          width: "1/2",
        },
        {
          id: "notes",
          name: "notes",
          type: "text",
          label: t("subscriptions.forms.renew.fields.notes", { defaultValue: "Notes" }),
          width: "1/2",
        },
      ],
    },
  ],
})

export const cancelSubscriptionForm = (t: TFunction): FormConfig => ({
  id: "cancel-subscription",
  title: t("subscriptions.forms.cancel.title", { defaultValue: "Cancel subscription" }),
  description: t("subscriptions.forms.cancel.description", {
    defaultValue: "Close the contract and optionally issue an OutRefund credit note.",
  }),
  sections: [
    {
      id: "cancel-main",
      title: t("subscriptions.forms.cancel.sections.main", { defaultValue: "Cancel" }),
      fields: [
        {
          id: "createCreditNote",
          name: "createCreditNote",
          type: "checkbox",
          label: t("subscriptions.forms.cancel.fields.createCreditNote", {
            defaultValue: "Create credit note from last posted invoice",
          }),
          defaultValue: true,
          width: "full",
        },
        {
          id: "invoiceMoveId",
          name: "invoiceMoveId",
          type: "select",
          label: t("subscriptions.forms.cancel.fields.invoiceMoveId", {
            defaultValue: "Invoice (optional)",
          }),
          width: "full",
          options: emptySelect,
        },
        {
          id: "notes",
          name: "notes",
          type: "textarea",
          label: t("subscriptions.forms.cancel.fields.notes", { defaultValue: "Notes" }),
          width: "full",
        },
      ],
    },
  ],
})

export const ingestSubscriptionUsageEventForm = (t: TFunction): FormConfig => ({
  id: "ingest-subscription-usage-event",
  title: t("subscriptions.forms.ingestUsage.title", { defaultValue: "Ingest usage event" }),
  description: t("subscriptions.forms.ingestUsage.description", {
    defaultValue: "Append an idempotent meter event (org+source+event id).",
  }),
  sections: [
    {
      id: "usage-main",
      title: t("subscriptions.forms.ingestUsage.sections.main", { defaultValue: "Usage" }),
      fields: [
        {
          id: "source",
          name: "source",
          type: "text",
          label: t("subscriptions.forms.ingestUsage.fields.source", { defaultValue: "Source" }),
          required: true,
          defaultValue: "meter",
          width: "1/2",
        },
        {
          id: "eventId",
          name: "eventId",
          type: "text",
          label: t("subscriptions.forms.ingestUsage.fields.eventId", { defaultValue: "Event id" }),
          required: true,
          width: "1/2",
        },
        {
          id: "quantity",
          name: "quantity",
          type: "number",
          label: t("subscriptions.forms.ingestUsage.fields.quantity", { defaultValue: "Quantity" }),
          required: true,
          width: "1/2",
        },
        {
          id: "unit",
          name: "unit",
          type: "text",
          label: t("subscriptions.forms.ingestUsage.fields.unit", { defaultValue: "Unit" }),
          defaultValue: "unit",
          width: "1/2",
        },
      ],
    },
  ],
})

export const createSubscriptionPriceTierForm = (t: TFunction): FormConfig => ({
  id: "create-subscription-price-tier",
  title: t("subscriptions.forms.priceTier.title", { defaultValue: "Add price tier" }),
  description: t("subscriptions.forms.priceTier.description", {
    defaultValue: "Progressive volume band for usage rating.",
  }),
  sections: [
    {
      id: "tier-main",
      title: t("subscriptions.forms.priceTier.sections.main", { defaultValue: "Tier" }),
      fields: [
        {
          id: "planId",
          name: "planId",
          type: "select",
          label: t("subscriptions.forms.priceTier.fields.planId", { defaultValue: "Plan" }),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "sequence",
          name: "sequence",
          type: "number",
          label: t("subscriptions.forms.priceTier.fields.sequence", { defaultValue: "Sequence" }),
          defaultValue: 1,
          width: "1/2",
        },
        {
          id: "minQty",
          name: "minQty",
          type: "number",
          label: t("subscriptions.forms.priceTier.fields.minQty", { defaultValue: "Min qty" }),
          required: true,
          defaultValue: 0,
          width: "1/3",
        },
        {
          id: "maxQty",
          name: "maxQty",
          type: "number",
          label: t("subscriptions.forms.priceTier.fields.maxQty", {
            defaultValue: "Max qty (empty = open)",
          }),
          width: "1/3",
        },
        {
          id: "unitPrice",
          name: "unitPrice",
          type: "number",
          label: t("subscriptions.forms.priceTier.fields.unitPrice", { defaultValue: "Unit price" }),
          required: true,
          width: "1/3",
        },
      ],
    },
  ],
})

export const setSubscriptionCommitmentForm = (t: TFunction): FormConfig => ({
  id: "set-subscription-commitment",
  title: t("subscriptions.forms.commitment.title", { defaultValue: "Set minimum commitment" }),
  description: t("subscriptions.forms.commitment.description", {
    defaultValue: "True-up floor applied when usage is below this amount at invoice time.",
  }),
  sections: [
    {
      id: "commit-main",
      title: t("subscriptions.forms.commitment.sections.main", { defaultValue: "Commitment" }),
      fields: [
        {
          id: "minAmount",
          name: "minAmount",
          type: "number",
          label: t("subscriptions.forms.commitment.fields.minAmount", {
            defaultValue: "Minimum amount",
          }),
          required: true,
          width: "1/2",
        },
        {
          id: "active",
          name: "active",
          type: "checkbox",
          label: t("subscriptions.forms.commitment.fields.active", { defaultValue: "Active" }),
          defaultValue: true,
          width: "1/2",
        },
      ],
    },
  ],
})

export const subscriptionsFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-subscription": newSubscriptionForm(t),
  "new-subscription-plan": newSubscriptionPlanForm(t),
  "new-deferred-revenue-schedule": newDeferredRevenueScheduleForm(t),
  "new-revenue-recognition-rule": newRevenueRecognitionRuleForm(t),
  "close-subscription": closeSubscriptionForm(t),
  "generate-subscription-invoice": generateSubscriptionInvoiceForm(t),
  "pay-subscription-invoice": paySubscriptionInvoiceForm(t),
  "amend-subscription": amendSubscriptionForm(t),
  "renew-subscription": renewSubscriptionForm(t),
  "cancel-subscription": cancelSubscriptionForm(t),
  "ingest-subscription-usage-event": ingestSubscriptionUsageEventForm(t),
  "create-subscription-price-tier": createSubscriptionPriceTierForm(t),
  "set-subscription-commitment": setSubscriptionCommitmentForm(t),
  "recognize-deferred-revenue-line": recognizeDeferredRevenueLineForm(t),
  "import-subscription-plan-csv": importSubscriptionPlanCsvForm(t),
  "import-subscription-csv": importSubscriptionCsvForm(t),
})
