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
  const stopDay = defaults.stop.slice(0, 10)
  if (defaults.allday && defaults.start && defaults.stop > defaults.start && /^\d{4}-\d{2}-\d{2}T00:00(?::00)?$/.test(defaults.stop)) {
    const stop = new Date(`${stopDay}T12:00:00Z`)
    stop.setUTCDate(stop.getUTCDate() - 1)
    return stop.toISOString().slice(0, 10)
  }
  return defaults.stop.slice(0, 10)
}

export const newCalendarEventForm = (t: TFunction, defaults?: CalendarEventDefaults, mode: "create" | "edit" = defaults ? "edit" : "create", timeZone?: string): FormConfig => ({
  id: mode === "edit" ? "edit-calendar-event" : "new-calendar-event",
  title: mode === "edit" ? t("calendar.forms.editEvent.title") : t("calendar.forms.newEvent.title"),
  description: timeZone ? t("calendar.forms.timezoneHint", { defaultValue: "Times use {{timezone}}. Unavailable daylight-saving times are rejected; new repeated times use the earlier occurrence. Unchanged event times keep their original occurrence.", timezone: timeZone }) : mode === "edit" ? t("calendar.forms.editEvent.description") : t("calendar.forms.newEvent.description"),
  submitLabel: mode === "edit" ? t("calendar.forms.editEvent.submit", { defaultValue: "Save event changes" }) : t("calendar.forms.newEvent.submit", { defaultValue: "Create event" }),
  sections: [
    {
      id: "event-details",
      title: t("calendar.forms.newEvent.sections.eventDetails"),
      fields: [
        ...(timeZone ? [{ id: "eventTimezone", name: "eventTimezone", type: "hidden" as const, defaultValue: timeZone }] : []),
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
          timeZone,
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
          timeZone,
          label: t("calendar.forms.newEvent.fields.stop"),
          required: true,
          width: "1/2",
          defaultValue: defaults?.stop,
          visibleWhen: { field: "allday", oneOf: ["false", ""] },
        },
        {
          id: "allDayStart", name: "allDayStart", type: "date", timeZone,
          label: t("calendar.forms.newEvent.fields.startDate", { defaultValue: "Start date" }),
          required: true, width: "1/2", defaultValue: defaults?.start?.slice(0, 10),
          visibleWhen: { field: "allday", equals: "true" },
        },
        {
          id: "allDayEnd", name: "allDayEnd", type: "date", timeZone,
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
