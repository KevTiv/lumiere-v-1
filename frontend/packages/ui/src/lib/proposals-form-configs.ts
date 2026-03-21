import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export const newProposalForm = (t: TFunction): FormConfig => ({
  id: "new-proposal",
  title: t("proposals.forms.newProposal.title"),
  description: t("proposals.forms.newProposal.description"),
  sections: [
    {
      id: "proposal-basics",
      title: t("proposals.forms.newProposal.sections.proposalDetails"),
      fields: [
        {
          id: "title",
          type: "text",
          label: t("proposals.forms.newProposal.fields.title"),
          placeholder: t("proposals.forms.newProposal.fields.titlePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "clientName",
          type: "text",
          label: t("proposals.forms.newProposal.fields.clientName"),
          placeholder: t("proposals.forms.newProposal.fields.clientNamePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "type",
          type: "select",
          label: t("proposals.forms.newProposal.fields.type"),
          required: true,
          width: "1/2",
          options: [
            { value: "tender", label: t("proposals.forms.newProposal.fields.options.tender") },
            { value: "commercial", label: t("proposals.forms.newProposal.fields.options.commercial") },
            { value: "grant", label: t("proposals.forms.newProposal.fields.options.grant") },
            { value: "partnership", label: t("proposals.forms.newProposal.fields.options.partnership") },
            { value: "internal", label: t("proposals.forms.newProposal.fields.options.internal") },
            { value: "other", label: t("proposals.forms.newProposal.fields.options.other") },
          ],
        },
        {
          id: "value",
          type: "number",
          label: t("proposals.forms.newProposal.fields.value"),
          placeholder: "0.00",
          width: "1/2",
        },
        {
          id: "deadline",
          type: "date",
          label: t("proposals.forms.newProposal.fields.deadline"),
          width: "1/2",
        },
        {
          id: "description",
          type: "textarea",
          label: t("proposals.forms.newProposal.fields.description"),
          placeholder: t("proposals.forms.newProposal.fields.descriptionPlaceholder"),
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
})

export const proposalsFormConfigs = (t: TFunction) => ({
  [newProposalForm(t).id]: newProposalForm(t),
})
