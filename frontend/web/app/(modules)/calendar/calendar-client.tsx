"use client"

import { calendarModuleConfig } from "@/lib/module-dashboard-configs"
import { useTranslation } from "@lumiere/i18n"
import type { CreateCalendarEventParams } from "@lumiere/stdb"
import { calendarSubscriptions, getStdbConnection, useCalendarEvents, useCreateCalendarEvent, useStdbConnection } from "@lumiere/stdb"
import type { FormConfig, CalendarEvent as UICalendarEvent, ViewMode } from "@lumiere/ui"
import { FormModal, ModuleView, newCalendarEventForm } from "@lumiere/ui"
import { useEffect, useMemo, useState } from "react"
import { CalendarView } from "../../../../packages/ui/src/calendar-components/calendar-view"

interface CalendarClientProps {
  initialEvents?: Record<string, unknown>[]
  organizationId?: number
}

export function CalendarClient({ initialEvents, organizationId }: CalendarClientProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => calendarModuleConfig(t), [t])
  const orgId = BigInt(organizationId ?? 1)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("month")
  const [currentDate, setCurrentDate] = useState<Date>(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const { connected } = useStdbConnection()

  useEffect(() => {
    const conn = getStdbConnection()
    if (!conn || !connected) return
    conn.subscriptionBuilder()
      .onError((err) => console.error("[stdb] calendar subscription error", err))
      .subscribe(calendarSubscriptions(orgId))
  }, [connected, orgId])

  const { data: events = [] } = useCalendarEvents(orgId, initialEvents)
  const createCalendarEvent = useCreateCalendarEvent(orgId)

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
                { label: "Total Events", value: String(events.length), icon: "Calendar" },
                { label: "Confirmed", value: String(confirmed), icon: "CheckCircle" },
                { label: "All-Day Events", value: String(allDay), icon: "Sun" },
                { label: "Draft Events", value: String(events.length - confirmed), icon: "Clock" },
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
              />
            ),
          }
        }
        return tab
      }),
    }),
    [viewMode, selectedEventId, selectedDate, searchTerm, events.map, currentDate, liveSections, moduleConfig, t],
  )

  const data = useMemo(
    () => ({
      events: events as unknown as Record<string, unknown>[],
    }),
    [events],
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createEvent") {
      createCalendarEvent.mutate({
        name: formData.name as string,
        start: new Date(formData.start as string) as unknown as CreateCalendarEventParams["start"],
        stop: new Date(formData.stop as string) as unknown as CreateCalendarEventParams["stop"],
        allday: Boolean(formData.allday),
        privacy: (formData.privacy as string) ?? "public",
        showAs: "busy",
        state: "confirmed",
        recurrency: false,
        partnerIds: [],
        alarmIds: [],
        location: formData.location as string | undefined,
        description: formData.description as string | undefined,
      } as unknown as CreateCalendarEventParams)
    }
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
      />

      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? newCalendarEventForm(t)}
        onSubmit={(formData) => {
          if (quickActionForm) {
            handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
    </>
  )
}
