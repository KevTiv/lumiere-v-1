import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export const newHelpdeskTicketForm = (t: TFunction): FormConfig => ({
  id: "new-helpdesk-ticket",
  title: t("helpdesk.forms.newTicket.title"),
  description: t("helpdesk.forms.newTicket.description"),
  sections: [
    {
      id: "ticket-details",
      title: t("helpdesk.forms.newTicket.sections.ticketDetails"),
      fields: [
        {
          id: "name",
          type: "text",
          label: t("helpdesk.forms.newTicket.fields.name"),
          placeholder: t("helpdesk.forms.newTicket.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "partnerName",
          type: "text",
          label: t("helpdesk.forms.newTicket.fields.partnerName"),
          placeholder: t("helpdesk.forms.newTicket.fields.partnerNamePlaceholder"),
          width: "1/2",
        },
        {
          id: "partnerEmail",
          type: "text",
          label: t("helpdesk.forms.newTicket.fields.partnerEmail"),
          placeholder: t("helpdesk.forms.newTicket.fields.partnerEmailPlaceholder"),
          width: "1/2",
        },
        {
          id: "priority",
          type: "select",
          label: t("helpdesk.forms.newTicket.fields.priority"),
          width: "1/2",
          options: [
            { value: "low", label: t("helpdesk.forms.newTicket.fields.options.low") },
            { value: "normal", label: t("helpdesk.forms.newTicket.fields.options.normal") },
            { value: "high", label: t("helpdesk.forms.newTicket.fields.options.high") },
            { value: "urgent", label: t("helpdesk.forms.newTicket.fields.options.urgent") },
          ],
        },
        {
          id: "teamId",
          type: "number",
          label: t("helpdesk.forms.newTicket.fields.teamId"),
          placeholder: "1",
          required: true,
          width: "1/2",
        },
        {
          id: "description",
          type: "textarea",
          label: t("helpdesk.forms.newTicket.fields.description"),
          placeholder: t("helpdesk.forms.newTicket.fields.descriptionPlaceholder"),
          width: "full",
          rows: 4,
        },
      ],
    },
  ],
})

export const helpdeskFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-helpdesk-ticket": newHelpdeskTicketForm(t),
})
