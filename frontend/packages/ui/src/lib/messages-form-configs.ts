import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

const emptySelect: Array<{ value: string; label: string; disabled?: boolean }> = []

export const newMailMessageForm = (t: TFunction): FormConfig => ({
  id: "new-mail-message",
  title: t("messages.forms.newMessage.title"),
  description: t("messages.forms.newMessage.description"),
  sections: [
    {
      id: "message-details",
      title: t("messages.forms.newMessage.sections.message"),
      fields: [
        {
          id: "messageType",
          name: "messageType",
          type: "select",
          label: t("messages.forms.newMessage.fields.messageType"),
          width: "1/2",
          options: [
            { value: "comment", label: t("messages.forms.newMessage.fields.options.comment") },
            { value: "email", label: t("messages.forms.newMessage.fields.options.email") },
            { value: "notification", label: t("messages.forms.newMessage.fields.options.notification") },
          ],
        },
        {
          id: "model",
          name: "model",
          type: "text",
          label: t("messages.forms.newMessage.fields.model"),
          placeholder: t("messages.forms.newMessage.fields.modelPlaceholder"),
          width: "1/2",
        },
        {
          id: "resId",
          name: "resId",
          type: "number",
          label: t("messages.forms.newMessage.fields.resId"),
          placeholder: "1",
          width: "1/2",
        },
        {
          id: "parentId",
          name: "parentId",
          type: "select",
          label: t("messages.forms.newMessage.fields.parentId"),
          placeholder: t("messages.forms.newMessage.fields.parentIdHint"),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "subtype",
          name: "subtype",
          type: "text",
          label: t("messages.forms.newMessage.fields.subtype"),
          placeholder: t("messages.forms.newMessage.fields.subtypePlaceholder"),
          width: "1/2",
        },
        {
          id: "body",
          name: "body",
          type: "textarea",
          label: t("messages.forms.newMessage.fields.body"),
          placeholder: t("messages.forms.newMessage.fields.bodyPlaceholder"),
          required: true,
          width: "full",
          rows: 4,
        },
      ],
    },
  ],
})

export const newMessageBatchForm = (t: TFunction): FormConfig => ({
  id: "new-message-batch",
  title: "New message batch",
  description: "Preview a template-controlled reminder batch before approval.",
  submitLabel: "Create batch",
  cancelLabel: t("common.cancel"),
  sections: [{ id: "batch", fields: [
    { id: "templateId", name: "templateId", type: "select", label: "Message template", required: true, width: "1/2", options: emptySelect },
    { id: "channel", name: "channel", type: "select", label: "Channel", required: true, width: "1/2", defaultValue: "WhatsApp", options: [{ value: "WhatsApp", label: "WhatsApp" }, { value: "Sms", label: "SMS" }, { value: "Email", label: "Email" }, { value: "InApp", label: "In-app" }] },
    { id: "subjectModel", name: "subjectModel", type: "text", label: "Subject model", required: true, width: "1/2", defaultValue: "account.move" },
    { id: "candidateContactIds", name: "candidateContactIds", type: "textarea", label: "Recipient contact IDs", placeholder: "1, 2, 3", required: true, width: "full", rows: 2 },
  ] }],
})

export const newMessageTemplateForm = (t: TFunction): FormConfig => ({
  id: "new-message-template",
  title: t("messages.forms.messageTemplate.title"),
  description: t("messages.forms.messageTemplate.description"),
  submitLabel: t("messages.forms.messageTemplate.submit"),
  cancelLabel: t("common.cancel"),
  sections: [{ id: "template", fields: [
    { id: "key", name: "key", type: "text", label: t("messages.forms.messageTemplate.key"), required: true, width: "1/2" },
    { id: "name", name: "name", type: "text", label: t("messages.forms.messageTemplate.name"), required: true, width: "1/2" },
    { id: "locale", name: "locale", type: "text", label: t("messages.forms.messageTemplate.locale"), required: true, defaultValue: "en", width: "1/2" },
    { id: "subject", name: "subject", type: "text", label: t("messages.forms.messageTemplate.subject"), width: "1/2" },
    { id: "bodyTemplate", name: "bodyTemplate", type: "textarea", label: t("messages.forms.messageTemplate.body"), required: true, width: "full", rows: 5 },
    { id: "allowedVariables", name: "allowedVariables", type: "text", label: t("messages.forms.messageTemplate.variables"), description: t("messages.forms.messageTemplate.variablesHint"), defaultValue: "customer_name, invoice_number, amount_due", width: "full" },
  ] }, {
    id: "channels",
    title: t("messages.forms.messageTemplate.channels"),
    fields: [
      { id: "channelWhatsApp", name: "channelWhatsApp", type: "checkbox", label: "WhatsApp", defaultValue: true, width: "1/4" },
      { id: "channelSms", name: "channelSms", type: "checkbox", label: "SMS", defaultValue: true, width: "1/4" },
      { id: "channelEmail", name: "channelEmail", type: "checkbox", label: "Email", defaultValue: false, width: "1/4" },
      { id: "channelInApp", name: "channelInApp", type: "checkbox", label: "In-app", defaultValue: false, width: "1/4" },
    ],
  }],
})

export const newInvoiceReminderBatchForm = (t: TFunction): FormConfig => ({
  id: "new-invoice-reminder-batch",
  title: t("messages.forms.invoiceReminder.title"),
  description: t("messages.forms.invoiceReminder.description"),
  submitLabel: t("messages.forms.invoiceReminder.submit"),
  cancelLabel: t("common.cancel"),
  sections: [{ id: "reminder", fields: [
    { id: "templateId", name: "templateId", type: "select", label: t("messages.forms.invoiceReminder.template"), required: true, width: "1/2", options: emptySelect },
    { id: "channel", name: "channel", type: "select", label: t("messages.forms.invoiceReminder.channel"), required: true, defaultValue: "WhatsApp", width: "1/2", options: [{ value: "WhatsApp", label: "WhatsApp" }, { value: "Sms", label: "SMS" }, { value: "Email", label: "Email" }, { value: "InApp", label: "In-app" }] },
    { id: "invoiceIds", name: "invoiceIds", type: "textarea", label: t("messages.forms.invoiceReminder.invoices"), description: t("messages.forms.invoiceReminder.invoicesHint"), required: true, width: "full", rows: 3 },
  ] }],
})

export const messagesFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-mail-message": newMailMessageForm(t),
  "new-message-batch": newMessageBatchForm(t),
  "new-message-template": newMessageTemplateForm(t),
  "new-invoice-reminder-batch": newInvoiceReminderBatchForm(t),
})

export const subscribeToRecordForm = (t: TFunction): FormConfig => ({
  id: "subscribe-to-record",
  title: t("messages.forms.subscribe.title"),
  description: t("messages.forms.subscribe.description"),
  submitLabel: t("messages.forms.subscribe.submit"),
  sections: [
    {
      id: "follower",
      fields: [
        {
          id: "resModel",
          name: "resModel",
          type: "text",
          label: t("messages.forms.subscribe.fields.resModel"),
          placeholder: t("messages.forms.newMessage.fields.modelPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "resId",
          name: "resId",
          type: "number",
          label: t("messages.forms.subscribe.fields.resId"),
          required: true,
          width: "1/2",
        },
        {
          id: "subtypes",
          name: "subtypes",
          type: "text",
          label: t("messages.forms.subscribe.fields.subtypes"),
          placeholder: t("messages.forms.subscribe.fields.subtypesPlaceholder"),
          defaultValue: "mail.mt_comment,mail.mt_note",
          width: "full",
        },
      ],
    },
  ],
})

export const unsubscribeFromRecordForm = (t: TFunction): FormConfig => ({
  id: "unsubscribe-from-record",
  title: t("messages.forms.unsubscribe.title"),
  description: t("messages.forms.unsubscribe.description"),
  submitLabel: t("messages.forms.unsubscribe.submit"),
  sections: [
    {
      id: "follower",
      fields: [
        {
          id: "resModel",
          name: "resModel",
          type: "text",
          label: t("messages.forms.unsubscribe.fields.resModel"),
          required: true,
          width: "1/2",
        },
        {
          id: "resId",
          name: "resId",
          type: "number",
          label: t("messages.forms.unsubscribe.fields.resId"),
          required: true,
          width: "1/2",
        },
      ],
    },
  ],
})
