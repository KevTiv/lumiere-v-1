import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

const emptySelect: Array<{ value: string; label: string; disabled?: boolean }> = []

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
          name: "name",
          type: "text",
          label: t("helpdesk.forms.newTicket.fields.name"),
          placeholder: t("helpdesk.forms.newTicket.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "teamId",
          name: "teamId",
          type: "select",
          label: t("helpdesk.forms.newTicket.fields.teamId"),
          placeholder: t("helpdesk.forms.newTicket.fields.teamPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "stageId",
          name: "stageId",
          type: "select",
          label: t("helpdesk.forms.newTicket.fields.stageId"),
          placeholder: t("helpdesk.forms.newTicket.fields.stagePlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "partnerName",
          name: "partnerName",
          type: "text",
          label: t("helpdesk.forms.newTicket.fields.partnerName"),
          placeholder: t("helpdesk.forms.newTicket.fields.partnerNamePlaceholder"),
          width: "1/2",
        },
        {
          id: "partnerEmail",
          name: "partnerEmail",
          type: "text",
          label: t("helpdesk.forms.newTicket.fields.partnerEmail"),
          placeholder: t("helpdesk.forms.newTicket.fields.partnerEmailPlaceholder"),
          width: "1/2",
        },
        {
          id: "priority",
          name: "priority",
          type: "select",
          label: t("helpdesk.forms.newTicket.fields.priority"),
          width: "1/2",
          defaultValue: "normal",
          options: [
            { value: "low", label: t("helpdesk.forms.newTicket.fields.options.low") },
            { value: "normal", label: t("helpdesk.forms.newTicket.fields.options.normal") },
            { value: "high", label: t("helpdesk.forms.newTicket.fields.options.high") },
            { value: "urgent", label: t("helpdesk.forms.newTicket.fields.options.urgent") },
          ],
        },
        {
          id: "slaId",
          name: "slaId",
          type: "select",
          label: t("helpdesk.forms.newTicket.fields.slaId"),
          placeholder: t("helpdesk.forms.newTicket.fields.slaPlaceholder"),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "description",
          name: "description",
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

export const newHelpdeskTeamForm = (t: TFunction): FormConfig => ({
  id: "new-helpdesk-team",
  title: t("helpdesk.forms.newTeam.title"),
  description: t("helpdesk.forms.newTeam.description"),
  sections: [
    {
      id: "team",
      title: t("helpdesk.forms.newTeam.sections.details"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("helpdesk.forms.newTeam.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("helpdesk.forms.newTeam.fields.description"),
          rows: 3,
          width: "full",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "switch",
          label: t("helpdesk.forms.newTeam.fields.isActive"),
          defaultValue: true,
          width: "full",
        },
      ],
    },
  ],
})

export const newHelpdeskStageForm = (t: TFunction): FormConfig => ({
  id: "new-helpdesk-stage",
  title: t("helpdesk.forms.newStage.title"),
  description: t("helpdesk.forms.newStage.description"),
  sections: [
    {
      id: "stage",
      title: t("helpdesk.forms.newStage.sections.details"),
      columns: 2,
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("helpdesk.forms.newStage.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "teamId",
          name: "teamId",
          type: "select",
          label: t("helpdesk.forms.newStage.fields.teamId"),
          placeholder: t("helpdesk.forms.newStage.fields.teamPlaceholder"),
          options: emptySelect,
          width: "1/2",
        },
        {
          id: "sequence",
          name: "sequence",
          type: "number",
          label: t("helpdesk.forms.newStage.fields.sequence"),
          defaultValue: 10,
          width: "1/2",
        },
        {
          id: "isClosed",
          name: "isClosed",
          type: "switch",
          label: t("helpdesk.forms.newStage.fields.isClosed"),
          defaultValue: false,
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("helpdesk.forms.newStage.fields.description"),
          rows: 2,
          width: "full",
        },
        {
          id: "template",
          name: "template",
          type: "text",
          label: t("helpdesk.forms.newStage.fields.template"),
          width: "full",
        },
      ],
    },
  ],
})

export const newHelpdeskSlaForm = (t: TFunction): FormConfig => ({
  id: "new-helpdesk-sla",
  title: t("helpdesk.forms.newSla.title"),
  description: t("helpdesk.forms.newSla.description"),
  sections: [
    {
      id: "sla",
      title: t("helpdesk.forms.newSla.sections.details"),
      columns: 2,
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("helpdesk.forms.newSla.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "teamId",
          name: "teamId",
          type: "select",
          label: t("helpdesk.forms.newSla.fields.teamId"),
          required: true,
          options: emptySelect,
          width: "1/2",
        },
        {
          id: "stageId",
          name: "stageId",
          type: "select",
          label: t("helpdesk.forms.newSla.fields.stageId"),
          required: true,
          options: emptySelect,
          width: "1/2",
        },
        {
          id: "priority",
          name: "priority",
          type: "select",
          label: t("helpdesk.forms.newSla.fields.priority"),
          required: true,
          defaultValue: "normal",
          width: "1/2",
          options: [
            { value: "low", label: t("helpdesk.forms.newTicket.fields.options.low") },
            { value: "normal", label: t("helpdesk.forms.newTicket.fields.options.normal") },
            { value: "high", label: t("helpdesk.forms.newTicket.fields.options.high") },
            { value: "urgent", label: t("helpdesk.forms.newTicket.fields.options.urgent") },
          ],
        },
        {
          id: "timeDays",
          name: "timeDays",
          type: "number",
          label: t("helpdesk.forms.newSla.fields.timeDays"),
          defaultValue: 0,
          width: "1/4",
        },
        {
          id: "timeHours",
          name: "timeHours",
          type: "number",
          label: t("helpdesk.forms.newSla.fields.timeHours"),
          defaultValue: 8,
          width: "1/4",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "switch",
          label: t("helpdesk.forms.newSla.fields.isActive"),
          defaultValue: true,
          width: "full",
        },
      ],
    },
  ],
})

export const helpdeskCsvImportForm = (t: TFunction, kind: "ticket" | "team" | "stage" | "sla"): FormConfig => ({
  id: `helpdesk-csv-import-${kind}`,
  title: t(`helpdesk.forms.csvImport.${kind}.title`),
  description: t(`helpdesk.forms.csvImport.${kind}.description`),
  sections: [
    {
      id: "csv",
      fields: [
        {
          id: "csvData",
          name: "csvData",
          type: "textarea",
          label: t("helpdesk.forms.csvImport.pasteLabel"),
          placeholder: t("helpdesk.forms.csvImport.pastePlaceholder"),
          required: true,
          rows: 12,
          width: "full",
        },
      ],
    },
  ],
})

export const helpdeskFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-helpdesk-ticket": newHelpdeskTicketForm(t),
  "new-helpdesk-team": newHelpdeskTeamForm(t),
  "new-helpdesk-stage": newHelpdeskStageForm(t),
  "new-helpdesk-sla": newHelpdeskSlaForm(t),
})
