import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export const newLeadForm = (t: TFunction): FormConfig => ({
  id: "new-lead",
  title: t("crm.forms.newLead.title"),
  description: t("crm.forms.newLead.description"),
  sections: [
    {
      id: "lead-contact",
      title: t("crm.forms.newLead.sections.contact"),
      fields: [
        {
          id: "contactName",
          type: "text",
          label: t("crm.forms.newLead.fields.contactName"),
          placeholder: t("crm.forms.newLead.fields.contactNamePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "partnerName",
          type: "text",
          label: t("crm.forms.newLead.fields.partnerName"),
          placeholder: t("crm.forms.newLead.fields.partnerNamePlaceholder"),
          width: "1/2",
        },
        {
          id: "emailFrom",
          type: "text",
          label: t("crm.forms.newLead.fields.emailFrom"),
          placeholder: t("crm.forms.newLead.fields.emailFromPlaceholder"),
          width: "1/2",
        },
        {
          id: "phone",
          type: "text",
          label: t("crm.forms.newLead.fields.phone"),
          placeholder: t("crm.forms.newLead.fields.phonePlaceholder"),
          width: "1/2",
        },
      ],
    },
    {
      id: "lead-details",
      title: t("crm.forms.newLead.sections.details"),
      fields: [
        {
          id: "expectedRevenue",
          type: "number",
          label: t("crm.forms.newLead.fields.expectedRevenue"),
          placeholder: "0",
          width: "1/2",
        },
        {
          id: "probability",
          type: "number",
          label: t("crm.forms.newLead.fields.probability"),
          placeholder: t("crm.forms.newLead.fields.probabilityPlaceholder"),
          width: "1/2",
        },
        {
          id: "description",
          type: "textarea",
          label: t("crm.forms.newLead.fields.description"),
          placeholder: t("crm.forms.newLead.fields.descriptionPlaceholder"),
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
})

export const newOpportunityForm = (t: TFunction): FormConfig => ({
  id: "new-opportunity",
  title: t("crm.forms.newOpportunity.title"),
  description: t("crm.forms.newOpportunity.description"),
  sections: [
    {
      id: "opp-info",
      title: t("crm.forms.newOpportunity.sections.opportunity"),
      fields: [
        {
          id: "name",
          type: "text",
          label: t("crm.forms.newOpportunity.fields.name"),
          placeholder: t("crm.forms.newOpportunity.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "expectedRevenue",
          type: "number",
          label: t("crm.forms.newOpportunity.fields.expectedRevenue"),
          placeholder: "0",
          width: "1/2",
        },
        {
          id: "probability",
          type: "number",
          label: t("crm.forms.newOpportunity.fields.probability"),
          placeholder: t("crm.forms.newOpportunity.fields.probabilityPlaceholder"),
          width: "1/2",
        },
        {
          id: "dateDeadline",
          type: "date",
          label: t("crm.forms.newOpportunity.fields.dateDeadline"),
          width: "1/2",
        },
        {
          id: "priority",
          type: "select",
          label: t("crm.forms.newOpportunity.fields.priority"),
          width: "1/2",
          options: [
            { value: "Low", label: t("crm.forms.newOpportunity.fields.options.Low") },
            { value: "Medium", label: t("crm.forms.newOpportunity.fields.options.Medium") },
            { value: "High", label: t("crm.forms.newOpportunity.fields.options.High") },
          ],
        },
      ],
    },
  ],
})

export const newContactForm = (t: TFunction): FormConfig => ({
  id: "new-contact",
  title: t("crm.forms.newContact.title"),
  description: t("crm.forms.newContact.description"),
  sections: [
    {
      id: "contact-identity",
      title: t("crm.forms.newContact.sections.identity"),
      fields: [
        {
          id: "name",
          type: "text",
          label: t("crm.forms.newContact.fields.name"),
          placeholder: t("crm.forms.newContact.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "isCompany",
          type: "checkbox",
          label: t("crm.forms.newContact.fields.isCompany"),
          width: "1/2",
        },
      ],
    },
    {
      id: "contact-details",
      title: t("crm.forms.newContact.sections.details"),
      fields: [
        {
          id: "email",
          type: "text",
          label: t("crm.forms.newContact.fields.email"),
          placeholder: t("crm.forms.newContact.fields.emailPlaceholder"),
          width: "1/2",
        },
        {
          id: "phone",
          type: "text",
          label: t("crm.forms.newContact.fields.phone"),
          placeholder: t("crm.forms.newContact.fields.phonePlaceholder"),
          width: "1/2",
        },
        {
          id: "city",
          type: "text",
          label: t("crm.forms.newContact.fields.city"),
          width: "1/2",
        },
        {
          id: "zip",
          type: "text",
          label: t("crm.forms.newContact.fields.zip"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const newActivityForm = (t: TFunction): FormConfig => ({
  id: "new-activity",
  title: t("crm.forms.newActivity.title"),
  description: t("crm.forms.newActivity.description"),
  sections: [
    {
      id: "activity-details",
      title: t("crm.forms.newActivity.sections.activityDetails"),
      fields: [
        {
          id: "summary",
          type: "text",
          label: t("crm.forms.newActivity.fields.summary"),
          placeholder: t("crm.forms.newActivity.fields.summaryPlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "activityTypeId",
          type: "number",
          label: t("crm.forms.newActivity.fields.activityTypeId"),
          placeholder: t("crm.forms.newActivity.fields.activityTypePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "dateDeadline",
          type: "date",
          label: t("crm.forms.newActivity.fields.dateDeadline"),
          required: true,
          width: "1/2",
        },
        {
          id: "userId",
          type: "number",
          label: t("crm.forms.newActivity.fields.userId"),
          placeholder: t("crm.forms.newActivity.fields.userIdPlaceholder"),
          width: "1/2",
        },
        {
          id: "note",
          type: "textarea",
          label: t("crm.forms.newActivity.fields.note"),
          placeholder: t("crm.forms.newActivity.fields.notePlaceholder"),
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
})

export const crmFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-lead": newLeadForm(t),
  "new-opportunity": newOpportunityForm(t),
  "new-contact": newContactForm(t),
  "new-activity": newActivityForm(t),
})
