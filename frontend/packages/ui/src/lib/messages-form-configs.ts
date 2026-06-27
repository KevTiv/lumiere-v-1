import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

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
          type: "text",
          label: t("messages.forms.newMessage.fields.parentId"),
          placeholder: t("messages.forms.newMessage.fields.parentIdHint"),
          width: "1/2",
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

export const messagesFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-mail-message": newMailMessageForm(t),
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
