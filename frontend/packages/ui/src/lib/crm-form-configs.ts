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
          id: "state",
          name: "state",
          type: "select",
          label: t("crm.forms.newLead.fields.state"),
          defaultValue: "qualified",
          options: [
            { value: "new", label: t("crm.leads.states.New") },
            { value: "qualified", label: t("crm.leads.states.Qualified") },
            { value: "won", label: t("crm.leads.states.Won") },
            { value: "lost", label: t("crm.leads.states.Lost") },
          ],
          width: "full",
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
        {
          id: "color",
          name: "color",
          type: "text",
          label: t("crm.forms.newOpportunity.fields.color"),
          placeholder: t("crm.forms.newOpportunity.fields.colorPlaceholder"),
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("crm.forms.newOpportunity.fields.description"),
          placeholder: t("crm.forms.newOpportunity.fields.descriptionPlaceholder"),
          width: "full",
          rows: 3,
        },
        ],
      },
    ],
})

export const changeOpportunityStageForm = (
  t: TFunction,
  stageOptions: OpportunityStageOption[] = [],
): FormConfig => ({
  id: "change-opportunity-stage",
  title: t("crm.forms.changeStage.title"),
  description: t("crm.forms.changeStage.description"),
  submitLabel: t("crm.forms.changeStage.submit"),
  sections: [
    {
      id: "stage",
      title: t("crm.forms.changeStage.sections.stage"),
      fields: [
        ...(stageOptions.length > 0
          ? ([
              {
                id: "stageId",
                name: "stageId",
                type: "select",
                label: t("crm.forms.changeStage.fields.stage"),
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
                label: t("crm.forms.changeStage.fields.stageId"),
                placeholder: t("crm.forms.changeStage.fields.stageIdPlaceholder"),
                required: true,
                width: "full",
              },
            ] as const satisfies readonly FormField[])),
      ],
    },
  ],
})

export const editOpportunityForm = (t: TFunction): FormConfig => ({
  id: "edit-opportunity",
  title: t("crm.forms.editOpportunity.title"),
  description: t("crm.forms.editOpportunity.description"),
  submitLabel: t("crm.forms.editOpportunity.submit"),
  sections: [
    {
      id: "opp-edit",
      title: t("crm.forms.editOpportunity.sections.opportunity"),
      fields: [
        {
          id: "partnerId",
          name: "partnerId",
          type: "select",
          label: t("crm.forms.editOpportunity.fields.partner"),
          width: "full",
          options: [],
        },
        {
          id: "expectedRevenue",
          name: "expectedRevenue",
          type: "number",
          label: t("crm.forms.editOpportunity.fields.expectedRevenue"),
          placeholder: "0",
          width: "1/2",
        },
        {
          id: "dateDeadline",
          name: "dateDeadline",
          type: "date",
          label: t("crm.forms.editOpportunity.fields.dateDeadline"),
          width: "1/2",
        },
        {
          id: "stageId",
          name: "stageId",
          type: "select",
          label: t("crm.forms.editOpportunity.fields.stage"),
          width: "full",
          options: [],
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("crm.forms.editOpportunity.fields.description"),
          placeholder: t("crm.forms.editOpportunity.fields.descriptionPlaceholder"),
          width: "full",
          rows: 3,
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
        {
          id: "color",
          name: "color",
          type: "text",
          label: t("crm.forms.newContact.fields.color"),
          placeholder: t("crm.forms.newContact.fields.colorPlaceholder"),
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("crm.forms.newContact.fields.description"),
          placeholder: t("crm.forms.newContact.fields.descriptionPlaceholder"),
          width: "full",
          rows: 3,
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

export const newContactTagForm = (t: TFunction): FormConfig => ({
  id: "new-contact-tag",
  title: t("crm.forms.newContactTag.title"),
  description: t("crm.forms.newContactTag.description"),
  sections: [
    {
      id: "tag",
      title: t("crm.forms.newContactTag.sections.tag"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("crm.forms.newContactTag.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "color",
          name: "color",
          type: "text",
          label: t("crm.forms.newContactTag.fields.color"),
          placeholder: t("crm.forms.newContactTag.fields.colorPlaceholder"),
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("crm.forms.newContactTag.fields.description"),
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
})

export const newContactSegmentForm = (t: TFunction): FormConfig => ({
  id: "new-contact-segment",
  title: t("crm.forms.newContactSegment.title"),
  description: t("crm.forms.newContactSegment.description"),
  sections: [
    {
      id: "segment",
      title: t("crm.forms.newContactSegment.sections.segment"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("crm.forms.newContactSegment.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "isDynamic",
          name: "isDynamic",
          type: "checkbox",
          label: t("crm.forms.newContactSegment.fields.isDynamic"),
          width: "1/2",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          label: t("crm.forms.newContactSegment.fields.isActive"),
          defaultValue: true,
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("crm.forms.newContactSegment.fields.description"),
          width: "full",
          rows: 2,
        },
        {
          id: "domain",
          name: "domain",
          type: "text",
          label: t("crm.forms.newContactSegment.fields.domain"),
          placeholder: t("crm.forms.newContactSegment.fields.domainPlaceholder"),
          width: "full",
        },
      ],
    },
  ],
})

export const editContactForm = (t: TFunction): FormConfig => ({
  id: "edit-contact",
  title: t("crm.forms.editContact.title"),
  description: t("crm.forms.editContact.description"),
  submitLabel: t("crm.forms.editContact.submit"),
  sections: [
    {
      id: "core",
      title: t("crm.forms.editContact.sections.core"),
      fields: [
        { id: "name", name: "name", type: "text", label: t("crm.forms.editContact.fields.name"), width: "full" },
        { id: "email", name: "email", type: "text", label: t("crm.forms.editContact.fields.email"), width: "1/2" },
        { id: "phone", name: "phone", type: "text", label: t("crm.forms.editContact.fields.phone"), width: "1/2" },
        { id: "mobile", name: "mobile", type: "text", label: t("crm.forms.editContact.fields.mobile"), width: "1/2" },
        {
          id: "isCustomer",
          name: "isCustomer",
          type: "checkbox",
          label: t("crm.forms.editContact.fields.isCustomer"),
          width: "1/2",
        },
        {
          id: "isVendor",
          name: "isVendor",
          type: "checkbox",
          label: t("crm.forms.editContact.fields.isVendor"),
          width: "1/2",
        },
        {
          id: "isProspect",
          name: "isProspect",
          type: "checkbox",
          label: t("crm.forms.editContact.fields.isProspect"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const editContactAddressForm = (t: TFunction): FormConfig => ({
  id: "edit-contact-address",
  title: t("crm.forms.editContactAddress.title"),
  submitLabel: t("crm.forms.editContactAddress.submit"),
  sections: [
    {
      id: "address",
      title: t("crm.forms.editContactAddress.sections.address"),
      fields: [
        { id: "street", name: "street", type: "text", label: t("crm.forms.editContactAddress.fields.street"), width: "full" },
        { id: "street2", name: "street2", type: "text", label: t("crm.forms.editContactAddress.fields.street2"), width: "full" },
        { id: "city", name: "city", type: "text", label: t("crm.forms.editContactAddress.fields.city"), width: "1/2" },
        { id: "stateCode", name: "stateCode", type: "text", label: t("crm.forms.editContactAddress.fields.stateCode"), width: "1/2" },
        { id: "zip", name: "zip", type: "text", label: t("crm.forms.editContactAddress.fields.zip"), width: "1/2" },
        { id: "countryCode", name: "countryCode", type: "text", label: t("crm.forms.editContactAddress.fields.countryCode"), width: "1/2" },
      ],
    },
  ],
})

export const editContactBusinessForm = (t: TFunction): FormConfig => ({
  id: "edit-contact-business",
  title: t("crm.forms.editContactBusiness.title"),
  submitLabel: t("crm.forms.editContactBusiness.submit"),
  sections: [
    {
      id: "business",
      title: t("crm.forms.editContactBusiness.sections.business"),
      fields: [
        { id: "taxId", name: "taxId", type: "text", label: t("crm.forms.editContactBusiness.fields.taxId"), width: "1/2" },
        { id: "industry", name: "industry", type: "text", label: t("crm.forms.editContactBusiness.fields.industry"), width: "1/2" },
        { id: "companyRegistry", name: "companyRegistry", type: "text", label: t("crm.forms.editContactBusiness.fields.companyRegistry"), width: "1/2" },
        { id: "employeesCount", name: "employeesCount", type: "number", label: t("crm.forms.editContactBusiness.fields.employeesCount"), width: "1/2" },
        { id: "annualRevenue", name: "annualRevenue", type: "number", label: t("crm.forms.editContactBusiness.fields.annualRevenue"), width: "1/2" },
      ],
    },
  ],
})

export const editContactDetailsForm = (t: TFunction): FormConfig => ({
  id: "edit-contact-details",
  title: t("crm.forms.editContactDetails.title"),
  submitLabel: t("crm.forms.editContactDetails.submit"),
  sections: [
    {
      id: "details",
      title: t("crm.forms.editContactDetails.sections.details"),
      fields: [
        { id: "firstName", name: "firstName", type: "text", label: t("crm.forms.editContactDetails.fields.firstName"), width: "1/2" },
        { id: "lastName", name: "lastName", type: "text", label: t("crm.forms.editContactDetails.fields.lastName"), width: "1/2" },
        { id: "title", name: "title", type: "text", label: t("crm.forms.editContactDetails.fields.title"), width: "1/2" },
        { id: "website", name: "website", type: "text", label: t("crm.forms.editContactDetails.fields.website"), width: "1/2" },
        { id: "emailSecondary", name: "emailSecondary", type: "text", label: t("crm.forms.editContactDetails.fields.emailSecondary"), width: "1/2" },
        { id: "fax", name: "fax", type: "text", label: t("crm.forms.editContactDetails.fields.fax"), width: "1/2" },
        { id: "color", name: "color", type: "text", label: t("crm.forms.editContactDetails.fields.color"), width: "1/2" },
        { id: "description", name: "description", type: "textarea", label: t("crm.forms.editContactDetails.fields.description"), width: "full", rows: 3 },
      ],
    },
  ],
})

export const editLeadDetailsForm = (t: TFunction): FormConfig => ({
  id: "edit-lead-details",
  title: t("crm.forms.editLeadDetails.title"),
  submitLabel: t("crm.forms.editLeadDetails.submit"),
  sections: [
    {
      id: "details",
      title: t("crm.forms.editLeadDetails.sections.details"),
      fields: [
        { id: "contactName", name: "contactName", type: "text", label: t("crm.forms.editLeadDetails.fields.contactName"), width: "full" },
        { id: "title", name: "title", type: "text", label: t("crm.forms.editLeadDetails.fields.title"), width: "1/2" },
        { id: "website", name: "website", type: "text", label: t("crm.forms.editLeadDetails.fields.website"), width: "1/2" },
        { id: "industry", name: "industry", type: "text", label: t("crm.forms.editLeadDetails.fields.industry"), width: "1/2" },
        { id: "referredBy", name: "referredBy", type: "text", label: t("crm.forms.editLeadDetails.fields.referredBy"), width: "1/2" },
        { id: "description", name: "description", type: "textarea", label: t("crm.forms.editLeadDetails.fields.description"), width: "full", rows: 3 },
      ],
    },
  ],
})

export const editLeadAddressForm = (t: TFunction): FormConfig => ({
  id: "edit-lead-address",
  title: t("crm.forms.editLeadAddress.title"),
  submitLabel: t("crm.forms.editLeadAddress.submit"),
  sections: [
    {
      id: "address",
      title: t("crm.forms.editLeadAddress.sections.address"),
      fields: [
        { id: "street", name: "street", type: "text", label: t("crm.forms.editLeadAddress.fields.street"), width: "full" },
        { id: "city", name: "city", type: "text", label: t("crm.forms.editLeadAddress.fields.city"), width: "1/2" },
        { id: "zip", name: "zip", type: "text", label: t("crm.forms.editLeadAddress.fields.zip"), width: "1/2" },
        { id: "countryCode", name: "countryCode", type: "text", label: t("crm.forms.editLeadAddress.fields.countryCode"), width: "1/2" },
      ],
    },
  ],
})

export const editLeadRevenueForm = (t: TFunction): FormConfig => ({
  id: "edit-lead-revenue",
  title: t("crm.forms.editLeadRevenue.title"),
  submitLabel: t("crm.forms.editLeadRevenue.submit"),
  sections: [
    {
      id: "revenue",
      title: t("crm.forms.editLeadRevenue.sections.revenue"),
      fields: [
        { id: "expectedRevenue", name: "expectedRevenue", type: "number", label: t("crm.forms.editLeadRevenue.fields.expectedRevenue"), width: "1/2" },
        { id: "probability", name: "probability", type: "number", label: t("crm.forms.editLeadRevenue.fields.probability"), width: "1/2" },
      ],
    },
  ],
})

const emptySelect: Array<{ value: string; label: string; disabled?: boolean }> = []

export const addOpportunityLineForm = (t: TFunction): FormConfig => ({
  id: "add-opportunity-line",
  title: t("crm.forms.addOpportunityLine.title"),
  description: t("crm.forms.addOpportunityLine.description"),
  sections: [
    {
      id: "ol-opportunity",
      title: t("crm.forms.addOpportunityLine.sections.opportunity"),
      fields: [
        {
          id: "opportunityId",
          name: "opportunityId",
          type: "select",
          label: t("crm.forms.addOpportunityLine.fields.opportunityId"),
          placeholder: t("crm.forms.addOpportunityLine.fields.opportunityPlaceholder"),
          required: true,
          width: "full",
          options: emptySelect,
        },
      ],
    },
    {
      id: "ol-product",
      title: t("crm.forms.addOpportunityLine.sections.product"),
      fields: [
        {
          id: "productId",
          name: "productId",
          type: "select",
          label: t("crm.forms.addOpportunityLine.fields.productId"),
          placeholder: t("crm.forms.addOpportunityLine.fields.productPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "uomId",
          name: "uomId",
          type: "select",
          label: t("crm.forms.addOpportunityLine.fields.uomId"),
          placeholder: t("crm.forms.addOpportunityLine.fields.uomPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "quantity",
          name: "quantity",
          type: "number",
          label: t("crm.forms.addOpportunityLine.fields.quantity"),
          required: true,
          width: "1/2",
        },
        {
          id: "priceUnit",
          name: "priceUnit",
          type: "number",
          label: t("crm.forms.addOpportunityLine.fields.priceUnit"),
          required: true,
          width: "1/2",
        },
      ],
    },
    {
      id: "ol-details",
      title: t("crm.forms.addOpportunityLine.sections.details"),
      fields: [
        {
          id: "discount",
          name: "discount",
          type: "number",
          label: t("crm.forms.addOpportunityLine.fields.discount"),
          width: "1/3",
          defaultValue: 0,
        },
        {
          id: "sequence",
          name: "sequence",
          type: "number",
          label: t("crm.forms.addOpportunityLine.fields.sequence"),
          width: "1/3",
          defaultValue: 10,
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("crm.forms.addOpportunityLine.fields.name"),
          placeholder: t("crm.forms.addOpportunityLine.fields.namePlaceholder"),
          width: "full",
        },
        {
          id: "taxIds",
          name: "taxIds",
          type: "textarea",
          label: t("crm.forms.addOpportunityLine.fields.taxIds"),
          placeholder: t("crm.forms.addOpportunityLine.fields.taxIdsPlaceholder"),
          description: t("crm.forms.addOpportunityLine.fields.taxIdsHint"),
          width: "full",
          rows: 2,
        },
      ],
    },
  ],
})

export const crmFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-lead": newLeadForm(t),
  "new-opportunity": newOpportunityForm(t),
  "edit-opportunity": editOpportunityForm(t),
  "change-opportunity-stage": changeOpportunityStageForm(t),
  "new-contact": newContactForm(t),
  "new-activity": newActivityForm(t),
  "convert-lead": convertLeadForm(t),
  "convert-opportunity-order": convertOpportunityToOrderForm(t),
  "assign-tag-contact": assignTagToContactForm(t),
  "add-contact-segment": addContactToSegmentForm(t),
  "new-contact-tag": newContactTagForm(t),
  "new-contact-segment": newContactSegmentForm(t),
  "edit-contact": editContactForm(t),
  "edit-contact-address": editContactAddressForm(t),
  "edit-contact-business": editContactBusinessForm(t),
  "edit-contact-details": editContactDetailsForm(t),
  "edit-lead-details": editLeadDetailsForm(t),
  "edit-lead-address": editLeadAddressForm(t),
  "edit-lead-revenue": editLeadRevenueForm(t),
  "add-opportunity-line": addOpportunityLineForm(t),
})
