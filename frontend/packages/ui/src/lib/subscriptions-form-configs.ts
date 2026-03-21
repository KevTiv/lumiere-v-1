import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

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
          id: "code",
          type: "text",
          label: t("subscriptions.forms.newSubscription.fields.code"),
          placeholder: t("subscriptions.forms.newSubscription.fields.codePlaceholder"),
          width: "1/2",
        },
        {
          id: "planId",
          type: "number",
          label: t("subscriptions.forms.newSubscription.fields.planId"),
          placeholder: "1",
          required: true,
          width: "1/2",
        },
        {
          id: "partnerId",
          type: "number",
          label: t("subscriptions.forms.newSubscription.fields.partnerId"),
          placeholder: "1",
          required: true,
          width: "1/2",
        },
        {
          id: "dateStart",
          type: "date",
          label: t("subscriptions.forms.newSubscription.fields.dateStart"),
          required: true,
          width: "1/2",
        },
        {
          id: "paymentMode",
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
          type: "textarea",
          label: t("subscriptions.forms.newSubscription.fields.description"),
          placeholder: t("subscriptions.forms.newSubscription.fields.descriptionPlaceholder"),
          width: "full",
          rows: 2,
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
          id: "name",
          type: "text",
          label: t("subscriptions.forms.newPlan.fields.name"),
          placeholder: t("subscriptions.forms.newPlan.fields.namePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "code",
          type: "text",
          label: t("subscriptions.forms.newPlan.fields.code"),
          placeholder: t("subscriptions.forms.newPlan.fields.codePlaceholder"),
          width: "1/2",
        },
        {
          id: "billingPeriod",
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
          type: "number",
          label: t("subscriptions.forms.newPlan.fields.billingPeriodUnit"),
          placeholder: "1",
          width: "1/2",
        },
        {
          id: "trialPeriod",
          type: "checkbox",
          label: t("subscriptions.forms.newPlan.fields.trialPeriod"),
          width: "1/2",
        },
        {
          id: "trialDuration",
          type: "number",
          label: t("subscriptions.forms.newPlan.fields.trialDuration"),
          placeholder: t("subscriptions.forms.newPlan.fields.trialDurationPlaceholder"),
          width: "1/2",
        },
        {
          id: "isDefault",
          type: "checkbox",
          label: t("subscriptions.forms.newPlan.fields.isDefault"),
          width: "1/2",
        },
        {
          id: "description",
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

export const subscriptionsFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-subscription": newSubscriptionForm(t),
  "new-subscription-plan": newSubscriptionPlanForm(t),
})
