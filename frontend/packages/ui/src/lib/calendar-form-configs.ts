import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export const newCalendarEventForm = (t: TFunction): FormConfig => ({
  id: "new-calendar-event",
  title: t("calendar.forms.newEvent.title"),
  description: t("calendar.forms.newEvent.description"),
  sections: [
    {
      id: "event-details",
      title: t("calendar.forms.newEvent.sections.eventDetails"),
      fields: [
        {
          id: "name",
          type: "text",
          label: t("calendar.forms.newEvent.fields.name"),
          placeholder: t("calendar.forms.newEvent.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "start",
          type: "date",
          label: t("calendar.forms.newEvent.fields.start"),
          required: true,
          width: "1/2",
        },
        {
          id: "stop",
          type: "date",
          label: t("calendar.forms.newEvent.fields.stop"),
          required: true,
          width: "1/2",
        },
        {
          id: "location",
          type: "text",
          label: t("calendar.forms.newEvent.fields.location"),
          placeholder: t("calendar.forms.newEvent.fields.locationPlaceholder"),
          width: "full",
        },
        {
          id: "allday",
          type: "checkbox",
          label: t("calendar.forms.newEvent.fields.allday"),
          width: "1/2",
        },
        {
          id: "privacy",
          type: "select",
          label: t("calendar.forms.newEvent.fields.privacy"),
          width: "1/2",
          options: [
            { value: "public", label: t("calendar.forms.newEvent.fields.options.public") },
            { value: "private", label: t("calendar.forms.newEvent.fields.options.private") },
            { value: "confidential", label: t("calendar.forms.newEvent.fields.options.confidential") },
          ],
        },
        {
          id: "description",
          type: "textarea",
          label: t("calendar.forms.newEvent.fields.description"),
          placeholder: t("calendar.forms.newEvent.fields.descriptionPlaceholder"),
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
})

export const calendarFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-calendar-event": newCalendarEventForm(t),
})
