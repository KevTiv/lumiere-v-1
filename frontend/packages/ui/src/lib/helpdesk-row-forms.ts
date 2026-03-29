import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

const emptySelect: Array<{ value: string; label: string; disabled?: boolean }> = [
  { value: "", label: "—", disabled: true },
]

export interface HelpdeskTicketDetailFormParams {
  ticketId: string
  name: string
  description: string
  stageId: string
  /** lower-case priority for select value: low | normal | high | urgent */
  priority: string
  /** Current assignee SpacetimeDB identity hex, or "" */
  agentIdentityHex: string
  stateTag: string
  stageOptions: Array<{ value: string; label: string; disabled?: boolean }>
  priorityOptions: Array<{ value: string; label: string }>
  agentOptions: Array<{ value: string; label: string; disabled?: boolean }>
}

/**
 * Form builder: edit ticket fields + assign agent (used with {@link mergeSelectOptionsForFields} or pre-built options).
 */
export function helpdeskTicketDetailForm(t: TFunction, p: HelpdeskTicketDetailFormParams): FormConfig {
  const stageOpts = p.stageOptions.length > 0 ? p.stageOptions : emptySelect
  const agentOpts =
    p.agentOptions.length > 0
      ? [{ value: "", label: t("helpdesk.forms.ticketDetail.agentUnassigned") }, ...p.agentOptions]
      : [{ value: "", label: t("helpdesk.forms.ticketDetail.noAgents"), disabled: true }]

  const closed = p.stateTag === "Closed"
  const canAssign = !closed

  return {
    id: `helpdesk-ticket-detail-${p.ticketId}`,
    title: t("helpdesk.forms.ticketDetail.title"),
    description: t("helpdesk.forms.ticketDetail.description", { id: p.ticketId }),
    size: "lg",
    icon: "LifeBuoy",
    submitLabel: t("helpdesk.forms.ticketDetail.save"),
    cancelLabel: t("common.cancel"),
    sections: [
      {
        id: "ticket-fields",
        title: t("helpdesk.forms.ticketDetail.sections.fields"),
        columns: 2,
        fields: [
          {
            type: "hidden",
            id: "ticketId",
            name: "ticketId",
            defaultValue: p.ticketId,
          },
          {
            type: "text",
            id: "name",
            name: "name",
            label: t("helpdesk.forms.newTicket.fields.name"),
            defaultValue: p.name,
            required: true,
            width: "full",
          },
          {
            type: "textarea",
            id: "description",
            name: "description",
            label: t("helpdesk.forms.newTicket.fields.description"),
            defaultValue: p.description,
            rows: 4,
            width: "full",
          },
          {
            type: "select",
            id: "stageId",
            name: "stageId",
            label: t("helpdesk.forms.newTicket.fields.stageId"),
            defaultValue: p.stageId,
            required: true,
            options: stageOpts,
            width: "1/2",
            disabled: closed,
          },
          {
            type: "select",
            id: "priority",
            name: "priority",
            label: t("helpdesk.forms.newTicket.fields.priority"),
            defaultValue: p.priority || "normal",
            options: p.priorityOptions,
            width: "1/2",
            disabled: closed,
          },
          {
            type: "select",
            id: "agentIdentityHex",
            name: "agentIdentityHex",
            label: t("helpdesk.forms.ticketDetail.assignTo"),
            defaultValue: p.agentIdentityHex,
            options: agentOpts,
            width: "full",
            disabled: !canAssign,
            description: closed
              ? t("helpdesk.forms.ticketDetail.assignDisabledClosed")
              : undefined,
          },
        ],
      },
    ],
  }
}
