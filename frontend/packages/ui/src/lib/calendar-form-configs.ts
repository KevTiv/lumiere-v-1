import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

interface CalendarEventDefaults {
  name?: string
  start?: string
  stop?: string
  allday?: boolean
  privacy?: string
  location?: string
  description?: string
}

export const newCalendarEventForm = (t: TFunction, defaults?: CalendarEventDefaults): FormConfig => ({
  id: defaults ? "edit-calendar-event" : "new-calendar-event",
  title: defaults ? t("calendar.forms.editEvent.title") : t("calendar.forms.newEvent.title"),
  description: defaults ? t("calendar.forms.editEvent.description") : t("calendar.forms.newEvent.description"),
  sections: [
    {
      id: "event-details",
      title: t("calendar.forms.newEvent.sections.eventDetails"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("calendar.forms.newEvent.fields.name"),
          placeholder: t("calendar.forms.newEvent.fields.namePlaceholder"),
          required: true,
          width: "full",
          defaultValue: defaults?.name,
        },
        {
          id: "start",
          name: "start",
          type: "datetime",
          label: t("calendar.forms.newEvent.fields.start"),
          required: true,
          width: "1/2",
          defaultValue: defaults?.start,
        },
        {
          id: "stop",
          name: "stop",
          type: "datetime",
          label: t("calendar.forms.newEvent.fields.stop"),
          required: true,
          width: "1/2",
          defaultValue: defaults?.stop,
        },
        {
          id: "location",
          name: "location",
          type: "text",
          label: t("calendar.forms.newEvent.fields.location"),
          placeholder: t("calendar.forms.newEvent.fields.locationPlaceholder"),
          width: "full",
          defaultValue: defaults?.location,
        },
        {
          id: "allday",
          name: "allday",
          type: "checkbox",
          label: t("calendar.forms.newEvent.fields.allday"),
          width: "1/2",
          defaultValue: defaults?.allday,
        },
        {
          id: "privacy",
          name: "privacy",
          type: "select",
          label: t("calendar.forms.newEvent.fields.privacy"),
          width: "1/2",
          options: [
            { value: "public", label: t("calendar.forms.newEvent.fields.options.public") },
            { value: "private", label: t("calendar.forms.newEvent.fields.options.private") },
            { value: "confidential", label: t("calendar.forms.newEvent.fields.options.confidential") },
          ],
          defaultValue: defaults?.privacy ?? "public",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("calendar.forms.newEvent.fields.description"),
          placeholder: t("calendar.forms.newEvent.fields.descriptionPlaceholder"),
          width: "full",
          rows: 3,
          defaultValue: defaults?.description,
        },
      ],
    },
  ],
})

export const calendarFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-calendar-event": newCalendarEventForm(t),
})
