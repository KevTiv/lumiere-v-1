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
          width: "full",
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

export const subscriptionsFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-subscription": newSubscriptionForm(t),
  "new-subscription-plan": newSubscriptionPlanForm(t),
  "new-deferred-revenue-schedule": newDeferredRevenueScheduleForm(t),
  "new-revenue-recognition-rule": newRevenueRecognitionRuleForm(t),
  "close-subscription": closeSubscriptionForm(t),
  "generate-subscription-invoice": generateSubscriptionInvoiceForm(t),
  "recognize-deferred-revenue-line": recognizeDeferredRevenueLineForm(t),
  "import-subscription-plan-csv": importSubscriptionPlanCsvForm(t),
  "import-subscription-csv": importSubscriptionCsvForm(t),
})
