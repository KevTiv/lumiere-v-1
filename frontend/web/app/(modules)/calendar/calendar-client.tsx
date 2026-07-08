"use client"

import { calendarModuleConfig } from "@/lib/module-dashboard-configs"
import { useCalendarModuleSubscription } from "@/lib/module-subscription-hooks"
import { toCreateCalendarEventParams } from "@/lib/calendar-create-params"
import { toCreateActivityParams } from "@/lib/crm-create-params"
import { useTranslation } from "@lumiere/i18n"
import { useCalendarEvents, useCreateCalendarEvent, useUpdateCalendarEvent, useDeleteCalendarEvent } from "@lumiere/query-hooks/hooks/calendar"
import type { UpdateCalendarEventParams } from "@lumiere/query-hooks/hooks/calendar"
import { useActivities, useCreateActivity } from "@lumiere/query-hooks/hooks/crm"
import type { FormConfig, CalendarEvent as UICalendarEvent, ViewMode } from "@lumiere/ui"
import { FormModal, ModuleView, newCalendarEventForm, newActivityForm, MissingOrganization } from "@lumiere/ui"
import { useEffect, useMemo, useState } from "react"
import { CalendarView } from "../../../../packages/ui/src/calendar-components/calendar-view"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"

interface CalendarClientProps {
  initialEvents?: Record<string, unknown>[]
  organizationId?: number
}

type CalendarClientLoadedProps = Omit<CalendarClientProps, "organizationId"> & {
  organizationId: number
}

function calendarTimestampMicros(_raw: unknown, date: Date): bigint {
  return BigInt(date.getTime() * 1000)
}

export function CalendarClient(props: CalendarClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <CalendarClientLoaded {...props} organizationId={props.organizationId} />
}

function CalendarClientLoaded({ initialEvents, organizationId }: CalendarClientLoadedProps) {
  useCalendarModuleSubscription()
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => calendarModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string; eventId?: string } | null>(null)
  const [formModalKey, setFormModalKey] = useState(0)

  useEffect(() => {
    if (quickActionForm != null) {
      setFormModalKey((k) => k + 1)
    }
  }, [quickActionForm])
  const [viewMode, setViewMode] = useState<ViewMode>("month")
  const [currentDate, setCurrentDate] = useState<Date>(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const { data: events = [] } = useCalendarEvents(orgId, initialEvents)
  const { data: activities = [] } = useActivities(orgId)
  const createCalendarEvent = useCreateCalendarEvent(orgId)
  const updateCalendarEvent = useUpdateCalendarEvent(orgId)
  const deleteCalendarEvent = useDeleteCalendarEvent(orgId)
  const createActivity = useCreateActivity(orgId)

  const liveSections = useMemo(() => {
    const confirmed = events?.filter((e) => String(e.state) === "confirmed").length
    const allDay = events?.filter((e) => e.allday).length

    const dashboardTab = moduleConfig.tabs.find((tab) => tab.id === "dashboard")
    if (!dashboardTab?.sections) return []

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: t("calendar.dashboard.totalEvents"), value: String(events.length), icon: "Calendar" },
                { label: t("calendar.dashboard.confirmed"), value: String(confirmed), icon: "CheckCircle" },
                { label: t("calendar.dashboard.allDayEvents"), value: String(allDay), icon: "Sun" },
                { label: t("calendar.dashboard.draftEvents"), value: String(events.length - confirmed), icon: "Clock" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_event: () => setQuickActionForm({ form: newCalendarEventForm(t), action: "createEvent" }),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        return w
      }),
    }))
  }, [events, moduleConfig, t])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) => {
        if (tab.id === "dashboard") return { ...tab, sections: liveSections }
        if (tab.id === "events") {
          return {
            ...tab,
            createForm: newCalendarEventForm(t),
          }
        }
        if (tab.id === "activities") {
          return {
            ...tab,
            label: t("calendar.activitiesTab"),
            createForm: newActivityForm(t),
          }
        }
        if (tab.id === "calendar") {
          const uiEvents: UICalendarEvent[] = events.map((e) => ({
            id: String(e.id),
            title: String(e.name ?? ""),
            description: e.description ? String(e.description) : undefined,
            startTime: new Date(Number(e.start ?? 0) / 1000),
            endTime: new Date(Number(e.stop ?? 0) / 1000),
            type: "meeting" as const,
            status: String(e.state) === "confirmed" ? "confirmed" as const : "scheduled" as const,
            createdBy: "",
            attendees: [],
            location: e.location ? String(e.location) : undefined,
            visibility: (String(e.privacy ?? "public") === "private" ? "private" : "public") as "private" | "team" | "public",
          }))
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <CalendarView
                className="my-4"
                events={uiEvents}
                viewMode={viewMode}
                currentDate={currentDate}
                selectedDate={selectedDate}
                searchTerm={searchTerm}
                selectedEventId={selectedEventId}
                onViewModeChange={setViewMode}
                onPrevMonth={() => setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                onNextMonth={() => setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                onToday={() => { setCurrentDate(new Date()); setSelectedDate(new Date()) }}
                onSelectDate={setSelectedDate}
                onSearchChange={setSearchTerm}
                onSelectEvent={setSelectedEventId}
                onCreateEvent={() => setQuickActionForm({ form: newCalendarEventForm(t), action: "createEvent" })}
                onEditEvent={(eventId) => {
                  const event = events.find((e) => String(e.id) === eventId)
                  if (event) {
                    setQuickActionForm({
                      form: newCalendarEventForm(t, {
                        name: String(event.name ?? ""),
                        start: new Date(Number(event.start ?? 0) / 1000).toISOString().slice(0, 16),
                        stop: new Date(Number(event.stop ?? 0) / 1000).toISOString().slice(0, 16),
                        allday: Boolean(event.allday),
                        privacy: String(event.privacy ?? "public"),
                        location: event.location ? String(event.location) : "",
                        description: event.description ? String(event.description) : "",
                      }),
                      action: "editEvent",
                      eventId,
                    })
                  }
                }}
                onDeleteEvent={(eventId) => {
                  if (confirm(t("calendar.confirmDelete"))) {
                    deleteCalendarEvent.mutate(eventId, {
                      onSuccess: () => setSelectedEventId(null),
                    })
                  }
                }}
              />
            ),
          }
        }
        return tab
      }),
    }),
    [viewMode, selectedEventId, selectedDate, searchTerm, events, currentDate, liveSections, moduleConfig, t],
  )

  const data = useMemo(
    () => ({
      events: events as unknown as Record<string, unknown>[],
      activities: activities as unknown as Record<string, unknown>[],
    }),
    [events, activities],
  )

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createActivity") {
      const p = toCreateActivityParams(formData)
      if (p) await createActivity.mutateAsync(p)
      return
    }
    if (action === "createEvent") {
      const params = toCreateCalendarEventParams(formData)
      if (!params) return
      createCalendarEvent.mutate(params)
    } else if (action === "editEvent" && quickActionForm?.eventId) {
      const title = String(formData.name ?? "").trim()
      if (!title) return
      const start = new Date(String(formData.start ?? ""))
      const stop = new Date(String(formData.stop ?? ""))
      if (Number.isNaN(start.getTime()) || Number.isNaN(stop.getTime())) return
      updateCalendarEvent.mutate({
        eventId: quickActionForm.eventId,
        params: ({
          name: title,
          start: calendarTimestampMicros(formData.start, start),
          stop: calendarTimestampMicros(formData.stop, stop),
          allday: Boolean(formData.allday),
          privacy: (formData.privacy as string) ?? "public",
          show_as: "busy",
          state: "confirmed",
          location: formData.location ? String(formData.location) : undefined,
          description: formData.description ? String(formData.description) : undefined,
        } satisfies UpdateCalendarEventParams) as Record<string, unknown>,
      })
    }
  }

  const isPending =
    createCalendarEvent.isPending ||
    updateCalendarEvent.isPending ||
    deleteCalendarEvent.isPending ||
    createActivity.isPending

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        isPending={isPending}
      />

      <FormModal
        key={formModalKey}
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? newCalendarEventForm(t)}
        isPending={isPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
    </>
  )
}
