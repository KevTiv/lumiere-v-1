"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "../components/skeleton"
import { ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, MapPin } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CalendarEvent, ViewMode } from "../lib/calendar-types"
import { calendarDayKey, calendarEventsForDay, calendarPeriodDays } from "../lib/calendar-dates"
import { EventDetailPanel } from "./event-detail-panel"

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const

interface CalendarViewProps {
  events: CalendarEvent[]
  viewMode: ViewMode
  currentDate: Date
  selectedDate: Date | null
  searchTerm: string
  selectedEventId: string | null
  className?: string
  onViewModeChange: (mode: ViewMode) => void
  onPrevMonth: () => void
  onNextMonth: () => void
  onToday: () => void
  onSelectDate: (date: Date) => void
  onSearchChange: (term: string) => void
  onSelectEvent: (id: string | null) => void
  onCreateEvent?: () => void
  onEditEvent?: (eventId: string) => void
  onDeleteEvent?: (eventId: string) => void
  eventHref?: (eventId: string) => string | undefined
}

export function CalendarView({
  events, viewMode, currentDate, selectedDate, searchTerm, selectedEventId, className,
  onViewModeChange, onPrevMonth, onNextMonth, onToday, onSelectDate, onSearchChange,
  onSelectEvent, onCreateEvent, onEditEvent, onDeleteEvent, eventHref,
}: CalendarViewProps) {
  const { t, i18n } = useTranslation()
  const [browserReady, setBrowserReady] = useState(false)
  useEffect(() => { setBrowserReady(true) }, [])
  const locale = i18n.language
  const filteredEvents = useMemo(() => {
    const term = searchTerm.trim().toLocaleLowerCase(locale)
    return events.filter((event) => !term || `${event.title} ${event.description ?? ""} ${event.location ?? ""}`.toLocaleLowerCase(locale).includes(term))
  }, [events, searchTerm, locale])
  // Date grouping and display use the browser's local timezone. Server and
  // first-client render must agree before those browser-specific values exist.
  if (!browserReady) return <div className={cn("min-w-0 space-y-4", className)} aria-busy="true" aria-label={t("common.loading", { defaultValue: "Loading" })} data-testid="calendar-workspace-loading"><Skeleton className="h-16 w-full" /><Skeleton className="h-64 w-full" /></div>
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const days = calendarPeriodDays(viewMode, currentDate)
  const selectedEvent = events.find((event) => event.id === selectedEventId)
  const labelDate = (date: Date) => date.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" })
  const monthYear = currentDate.toLocaleDateString(locale, { month: "long", year: "numeric" })
  const modes: Array<{ mode: ViewMode; label: string }> = [
    { mode: "agenda", label: t("calendar.workspace.agenda", { defaultValue: "Agenda" }) },
    { mode: "month", label: t("calendar.workspace.month", { defaultValue: "Month" }) },
    { mode: "week", label: t("calendar.workspace.week", { defaultValue: "Week" }) },
    { mode: "day", label: t("calendar.workspace.day", { defaultValue: "Day" }) },
  ]
  const timeLabel = (event: CalendarEvent) => {
    if (event.allDay) return t("calendar.workspace.allDay", { defaultValue: "All day" })
    const multiDay = calendarDayKey(event.startTime) !== calendarDayKey(event.endTime)
    const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", ...(multiDay ? { month: "short", day: "numeric" } : {}) }
    return `${event.startTime.toLocaleString(locale, options)} - ${event.endTime.toLocaleString(locale, options)}`
  }
  const eventButton = (event: CalendarEvent) => (
    <button
      type="button"
      key={event.id}
      onClick={() => onSelectEvent(event.id)}
      aria-pressed={event.id === selectedEventId}
      className={cn("flex w-full min-w-0 items-start justify-between gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring", event.id === selectedEventId && "border-primary", event.status === "cancelled" && "text-muted-foreground")}
      data-testid={`calendar-agenda-event-${event.id}`}
    >
      <span className="min-w-0 space-y-1">
        <span className={cn("block break-words text-sm font-medium", event.status === "cancelled" && "line-through")}>{event.title}</span>
        <span className="block text-xs text-muted-foreground">{timeLabel(event)}</span>
        {event.location && <span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3 shrink-0" />{event.location}</span>}
      </span>
      {event.status === "cancelled" && <Badge variant="secondary">{t("calendar.workspace.cancelled", { defaultValue: "Cancelled" })}</Badge>}
    </button>
  )
  const agendaDays = days.map((day) => ({ day, events: calendarEventsForDay(filteredEvents, day) })).filter((entry) => viewMode !== "agenda" || entry.events.length > 0)

  return (
    <div className={cn("min-w-0 space-y-4", className)} data-testid="calendar-workspace">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{monthYear}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("calendar.workspace.timezone", { defaultValue: "Times shown in {{timezone}}", timezone })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="min-h-11" variant="outline" onClick={onToday}>{t("calendar.view.today")}</Button>
          {onCreateEvent && <Button size="sm" className="min-h-11" onClick={onCreateEvent}><Plus className="size-4" />{t("calendar.view.newEvent")}</Button>}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label={t("calendar.workspace.view", { defaultValue: "Calendar view" })}>
            {modes.map(({ mode, label }) => <Button key={mode} size="sm" className="min-h-11" variant={viewMode === mode ? "default" : "outline"} aria-pressed={viewMode === mode} onClick={() => onViewModeChange(mode)}>{label}</Button>)}
          </div>
          <div className="flex gap-1">
            <Button size="icon" variant="outline" className="size-11" onClick={onPrevMonth} aria-label={t("calendar.workspace.previous", { defaultValue: "Previous period" })}><ChevronLeft className="size-4" /></Button>
            <Button size="icon" variant="outline" className="size-11" onClick={onNextMonth} aria-label={t("calendar.workspace.next", { defaultValue: "Next period" })}><ChevronRight className="size-4" /></Button>
          </div>
        </div>
        <Input aria-label={t("calendar.events.searchPlaceholder")} placeholder={t("calendar.events.searchPlaceholder")} value={searchTerm} onChange={(event) => onSearchChange(event.target.value)} className="w-full sm:max-w-64" />
      </div>
      {viewMode === "agenda" && <p className="text-sm text-muted-foreground">{t("calendar.workspace.agendaRange", { defaultValue: "{{start}} to {{end}}", start: labelDate(days[0]!), end: labelDate(days[days.length - 1]!) })}</p>}
      {viewMode === "month" ? (
        <div className="overflow-x-auto rounded-lg border bg-card p-3">
          <div className="grid min-w-[42rem] grid-cols-7 gap-2">
            {WEEKDAY_KEYS.map((key) => <div key={key} className="py-2 text-center text-xs font-medium text-muted-foreground">{t(`calendar.view.weekdaysShort.${key}`)}</div>)}
            {Array.from({ length: days[0]!.getDay() }, (_, index) => <div key={`blank-${index}`} aria-hidden />)}
            {days.map((date) => {
              const dayEvents = calendarEventsForDay(filteredEvents, date)
              return (
                <div key={calendarDayKey(date)} className={cn("min-h-28 min-w-0 space-y-1 rounded-md border p-2", selectedDate && calendarDayKey(selectedDate) === calendarDayKey(date) && "border-primary")}>
                  <button type="button" className="flex size-11 items-center justify-center rounded-md text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={labelDate(date)} aria-pressed={selectedDate != null && calendarDayKey(selectedDate) === calendarDayKey(date)} onClick={() => onSelectDate(date)}>{date.getDate()}</button>
                  {dayEvents.slice(0, 2).map((event) => <button key={event.id} type="button" onClick={() => onSelectEvent(event.id)} className={cn("block min-h-11 w-full truncate rounded bg-muted p-1 text-left text-xs hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring", event.status === "cancelled" && "line-through text-muted-foreground")}>{event.title}</button>)}
                  {dayEvents.length > 2 && <button type="button" className="min-h-11 text-xs text-primary underline" onClick={() => onSelectDate(date)}>{t("calendar.view.moreEvents", { count: dayEvents.length - 2 })}</button>}
                </div>
              )
            })}
          </div>
          {selectedDate && <section className="mt-4 space-y-2 border-t pt-4" aria-label={labelDate(selectedDate)}><h3 className="text-sm font-semibold">{labelDate(selectedDate)}</h3>{calendarEventsForDay(filteredEvents, selectedDate).map(eventButton)}</section>}
        </div>
      ) : agendaDays.some((entry) => entry.events.length) ? (
        <div className="space-y-5" data-testid="calendar-agenda">
          {agendaDays.map(({ day, events: dayEvents }) => <section key={calendarDayKey(day)} className="space-y-2" aria-label={labelDate(day)}><h3 className="text-sm font-semibold">{labelDate(day)}</h3>{dayEvents.length ? dayEvents.map(eventButton) : <p className="text-sm text-muted-foreground">{t("calendar.view.noEventsScheduled")}</p>}</section>)}
        </div>
      ) : <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border bg-card p-4 text-center text-muted-foreground"><CalendarIcon className="size-6" /><p className="text-sm">{t("calendar.view.noEventsScheduled")}</p></div>}
      {selectedEvent && <EventDetailPanel event={selectedEvent} onClose={() => onSelectEvent(null)} onEdit={onEditEvent ? () => onEditEvent(selectedEvent.id) : undefined} onDelete={onDeleteEvent ? () => onDeleteEvent(selectedEvent.id) : undefined} openHref={eventHref?.(selectedEvent.id)} />}
    </div>
  )
}
