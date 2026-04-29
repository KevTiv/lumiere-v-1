import type { TFunction } from "i18next"
import type { FormConfig, FormField } from "./form-types"

export type OpportunityStageOption = { value: string; label: string }

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
          name: "contactName",
          type: "text",
          label: t("crm.forms.newLead.fields.contactName"),
          placeholder: t("crm.forms.newLead.fields.contactNamePlaceholder"),
          required: true,
          // width: "1/2",
        },
        {
          id: "partnerName",
          name: "partnerName",
          type: "text",
          label: t("crm.forms.newLead.fields.partnerName"),
          placeholder: t("crm.forms.newLead.fields.partnerNamePlaceholder"),
          // width: "1/2",
        },
        {
          id: "emailFrom",
          name: "emailFrom",
          type: "text",
          label: t("crm.forms.newLead.fields.emailFrom"),
          placeholder: t("crm.forms.newLead.fields.emailFromPlaceholder"),
          // width: "1/2",
        },
        {
          id: "phone",
          name: "phone",
          type: "text",
          label: t("crm.forms.newLead.fields.phone"),
          placeholder: t("crm.forms.newLead.fields.phonePlaceholder"),
          // width: "1/2",
        },
      ],
    },
    {
      id: "lead-details",
      title: t("crm.forms.newLead.sections.details"),
      fields: [
        {
          id: "expectedRevenue",
          name: "expectedRevenue",
          type: "number",
          label: t("crm.forms.newLead.fields.expectedRevenue"),
          placeholder: "0",
          // width: "1/2",
        },
        {
          id: "probability",
          name: "probability",
          type: "number",
          label: t("crm.forms.newLead.fields.probability"),
          placeholder: t("crm.forms.newLead.fields.probabilityPlaceholder"),
          // width: "1/2",
        },
        {
          id: "description",
          name: "description",
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

export const newOpportunityForm = (
  t: TFunction,
  stageOptions: OpportunityStageOption[] = [],
): FormConfig => ({
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
          name: "name",
          type: "text",
          label: t("crm.forms.newOpportunity.fields.name"),
          placeholder: t("crm.forms.newOpportunity.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        ...(stageOptions.length > 0
          ? ([
              {
                id: "stageId",
                name: "stageId",
                type: "select",
                label: t("crm.forms.newOpportunity.fields.stage"),
                required: true,
                width: "full",
                options: stageOptions,
              },
            ] as const satisfies readonly FormField[])
          : ([
              {
                id: "stageId",
                name: "stageId",
                type: "number",
                label: t("crm.forms.newOpportunity.fields.stageId"),
                placeholder: t("crm.forms.newOpportunity.fields.stageIdPlaceholder"),
                required: true,
                width: "full",
              },
            ] as const satisfies readonly FormField[])),
        {
          id: "expectedRevenue",
          name: "expectedRevenue",
          type: "number",
          label: t("crm.forms.newOpportunity.fields.expectedRevenue"),
          placeholder: "0",
          // width: "1/2",
        },
        {
          id: "probability",
          name: "probability",
          type: "number",
          label: t("crm.forms.newOpportunity.fields.probability"),
          placeholder: t("crm.forms.newOpportunity.fields.probabilityPlaceholder"),
          // width: "1/2",
        },
        {
          id: "dateDeadline",
          name: "dateDeadline",
          type: "date",
          label: t("crm.forms.newOpportunity.fields.dateDeadline"),
          // width: "1/2",
        },
        {
          id: "priority",
          name: "priority",
          type: "select",
          label: t("crm.forms.newOpportunity.fields.priority"),
          // width: "1/2",
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
          name: "name",
          type: "text",
          label: t("crm.forms.newContact.fields.name"),
          placeholder: t("crm.forms.newContact.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "isCompany",
          name: "isCompany",
          type: "checkbox",
          label: t("crm.forms.newContact.fields.isCompany"),
          // width: "1/2",
        },
      ],
    },
    {
      id: "contact-details",
      title: t("crm.forms.newContact.sections.details"),
      fields: [
        {
          id: "email",
          name: "email",
          type: "text",
          label: t("crm.forms.newContact.fields.email"),
          placeholder: t("crm.forms.newContact.fields.emailPlaceholder"),
          // width: "1/2",
        },
        {
          id: "phone",
          name: "phone",
          type: "text",
          label: t("crm.forms.newContact.fields.phone"),
          placeholder: t("crm.forms.newContact.fields.phonePlaceholder"),
          // width: "1/2",
        },
        {
          id: "city",
          name: "city",
          type: "text",
          label: t("crm.forms.newContact.fields.city"),
          // width: "1/2",
        },
        {
          id: "zip",
          name: "zip",
          type: "text",
          label: t("crm.forms.newContact.fields.zip"),
          // width: "1/2",
        },
      ],
    },
  ],
})

/** Convert a qualified lead to contact / opportunity (form builder). */
export const convertLeadForm = (
  t: TFunction,
  stageOptions: OpportunityStageOption[] = [],
): FormConfig => {
  const stageField: FormField =
    stageOptions.length > 0
      ? {
          id: "opportunityStageId",
          name: "opportunityStageId",
          type: "select",
          label: t("crm.forms.convertLead.fields.opportunityStage"),
          width: "full",
          options: stageOptions,
        }
      : {
          id: "opportunityStageId",
          name: "opportunityStageId",
          type: "number",
          label: t("crm.forms.convertLead.fields.opportunityStageId"),
          placeholder: t("crm.forms.convertLead.fields.opportunityStageIdPlaceholder"),
          width: "full",
        }

  return {
    id: "convert-lead",
    title: t("crm.forms.convertLead.title"),
    description: t("crm.forms.convertLead.description"),
    sections: [
      {
        id: "convert-options",
        title: t("crm.forms.convertLead.sections.options"),
        fields: [
          {
            id: "createContact",
            name: "createContact",
            type: "checkbox",
            label: t("crm.forms.convertLead.fields.createContact"),
            width: "full",
          },
          {
            id: "createOpportunity",
            name: "createOpportunity",
            type: "checkbox",
            label: t("crm.forms.convertLead.fields.createOpportunity"),
            width: "full",
          },
          stageField,
        ],
      },
    ],
  }
}

/** Convert opportunity → sale order (requires pricelist + warehouse). */
export const convertOpportunityToOrderForm = (t: TFunction): FormConfig => ({
  id: "convert-opportunity-order",
  title: t("crm.forms.convertToSaleOrder.title"),
  description: t("crm.forms.convertToSaleOrder.description"),
  sections: [
    {
      id: "fulfillment",
      title: t("crm.forms.convertToSaleOrder.sections.fulfillment"),
      fields: [
        {
          id: "pricelistId",
          name: "pricelistId",
          type: "select",
          label: t("crm.forms.convertToSaleOrder.fields.pricelist"),
          required: true,
          width: "full",
          options: [],
        },
        {
          id: "warehouseId",
          name: "warehouseId",
          type: "select",
          label: t("crm.forms.convertToSaleOrder.fields.warehouse"),
          required: true,
          width: "full",
          options: [],
        },
      ],
    },
  ],
})

export const assignTagToContactForm = (t: TFunction): FormConfig => ({
  id: "assign-tag-contact",
  title: t("crm.forms.assignTag.title"),
  description: t("crm.forms.assignTag.description"),
  sections: [
    {
      id: "tag",
      title: t("crm.forms.assignTag.sections.tag"),
      fields: [
        {
          id: "tagId",
          name: "tagId",
          type: "number",
          label: t("crm.forms.assignTag.fields.tagId"),
          placeholder: t("crm.forms.assignTag.fields.tagIdPlaceholder"),
          required: true,
          width: "full",
        },
      ],
    },
  ],
})

export const addContactToSegmentForm = (t: TFunction): FormConfig => ({
  id: "add-contact-segment",
  title: t("crm.forms.addToSegment.title"),
  description: t("crm.forms.addToSegment.description"),
  sections: [
    {
      id: "segment",
      title: t("crm.forms.addToSegment.sections.segment"),
      fields: [
        {
          id: "segmentId",
          name: "segmentId",
          type: "number",
          label: t("crm.forms.addToSegment.fields.segmentId"),
          placeholder: t("crm.forms.addToSegment.fields.segmentIdPlaceholder"),
          required: true,
          width: "full",
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
          name: "summary",
          type: "text",
          label: t("crm.forms.newActivity.fields.summary"),
          placeholder: t("crm.forms.newActivity.fields.summaryPlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "activityTypeId",
          name: "activityTypeId",
          type: "number",
          label: t("crm.forms.newActivity.fields.activityTypeId"),
          placeholder: t("crm.forms.newActivity.fields.activityTypePlaceholder"),
          required: true,
          // width: "1/2",
        },
        {
          id: "dateDeadline",
          name: "dateDeadline",
          type: "date",
          label: t("crm.forms.newActivity.fields.dateDeadline"),
          required: true,
          // width: "1/2",
        },
        {
          id: "userId",
          name: "userId",
          type: "number",
          label: t("crm.forms.newActivity.fields.userId"),
          placeholder: t("crm.forms.newActivity.fields.userIdPlaceholder"),
          // width: "1/2",
        },
        {
          id: "note",
          name: "note",
          type: "textarea",
          label: t("crm.forms.newActivity.fields.note"),
          placeholder: t("crm.forms.newActivity.fields.notePlaceholder"),
          // width: "full",
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
  "convert-lead": convertLeadForm(t),
  "convert-opportunity-order": convertOpportunityToOrderForm(t),
  "assign-tag-contact": assignTagToContactForm(t),
  "add-contact-segment": addContactToSegmentForm(t),
})
