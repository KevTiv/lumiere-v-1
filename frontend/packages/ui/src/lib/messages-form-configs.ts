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
          type: "text",
          label: t("messages.forms.newMessage.fields.model"),
          placeholder: t("messages.forms.newMessage.fields.modelPlaceholder"),
          width: "1/2",
        },
        {
          id: "resId",
          type: "number",
          label: t("messages.forms.newMessage.fields.resId"),
          placeholder: "1",
          width: "1/2",
        },
        {
          id: "subtype",
          type: "text",
          label: t("messages.forms.newMessage.fields.subtype"),
          placeholder: t("messages.forms.newMessage.fields.subtypePlaceholder"),
          width: "1/2",
        },
        {
          id: "body",
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
