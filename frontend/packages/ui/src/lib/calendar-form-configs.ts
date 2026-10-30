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

function allDayLastDate(defaults?: CalendarEventDefaults): string | undefined {
  if (!defaults?.stop) return defaults?.start?.slice(0, 10)
  const stop = new Date(defaults.stop)
  const start = defaults.start ? new Date(defaults.start) : null
  if (defaults.allday && start && stop.getTime() > start.getTime() && stop.getHours() === 0 && stop.getMinutes() === 0) {
    stop.setDate(stop.getDate() - 1)
    return `${stop.getFullYear()}-${String(stop.getMonth() + 1).padStart(2, "0")}-${String(stop.getDate()).padStart(2, "0")}`
  }
  return defaults.stop.slice(0, 10)
}

export const newCalendarEventForm = (t: TFunction, defaults?: CalendarEventDefaults, mode: "create" | "edit" = defaults ? "edit" : "create"): FormConfig => ({
  id: mode === "edit" ? "edit-calendar-event" : "new-calendar-event",
  title: mode === "edit" ? t("calendar.forms.editEvent.title") : t("calendar.forms.newEvent.title"),
  description: mode === "edit" ? t("calendar.forms.editEvent.description") : t("calendar.forms.newEvent.description"),
  submitLabel: mode === "edit" ? t("calendar.forms.editEvent.submit", { defaultValue: "Save event changes" }) : t("calendar.forms.newEvent.submit", { defaultValue: "Create event" }),
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
          id: "allday", name: "allday", type: "checkbox",
          label: t("calendar.forms.newEvent.fields.allday"),
          width: "full", defaultValue: defaults?.allday ?? false,
        },
        {
          id: "start",
          name: "start",
          type: "datetime",
          label: t("calendar.forms.newEvent.fields.start"),
          required: true,
          width: "1/2",
          defaultValue: defaults?.start,
          visibleWhen: { field: "allday", oneOf: ["false", ""] },
        },
        {
          id: "stop",
          name: "stop",
          type: "datetime",
          label: t("calendar.forms.newEvent.fields.stop"),
          required: true,
          width: "1/2",
          defaultValue: defaults?.stop,
          visibleWhen: { field: "allday", oneOf: ["false", ""] },
        },
        {
          id: "allDayStart", name: "allDayStart", type: "date",
          label: t("calendar.forms.newEvent.fields.startDate", { defaultValue: "Start date" }),
          required: true, width: "1/2", defaultValue: defaults?.start?.slice(0, 10),
          visibleWhen: { field: "allday", equals: "true" },
        },
        {
          id: "allDayEnd", name: "allDayEnd", type: "date",
          label: t("calendar.forms.newEvent.fields.lastDate", { defaultValue: "Last day" }),
          description: t("calendar.forms.newEvent.fields.lastDateHint", { defaultValue: "Include this date in the event. For one day, choose the same date as the start." }),
          required: true, width: "1/2", defaultValue: allDayLastDate(defaults),
          visibleWhen: { field: "allday", equals: "true" },
        },
        ...(["originalAllDayStart", "originalAllDayStop", "originalAllDayStartDate", "originalAllDayEndDate"] as const).map((name) => ({
          id: name, name, type: "hidden" as const,
          defaultValue: mode === "edit" && defaults?.allday
            ? ({ originalAllDayStart: defaults.start, originalAllDayStop: defaults.stop, originalAllDayStartDate: defaults.start?.slice(0, 10), originalAllDayEndDate: allDayLastDate(defaults) })[name] ?? ""
            : "",
        })),
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
          id: "privacy",
          name: "privacy",
          type: "select",
          label: t("calendar.forms.newEvent.fields.privacy"),
          description: t("calendar.forms.newEvent.fields.privacyHint", { defaultValue: "Public, private and confidential describe visibility within your workspace. They do not publish an event on the internet; your organization's access rules still apply." }),
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
