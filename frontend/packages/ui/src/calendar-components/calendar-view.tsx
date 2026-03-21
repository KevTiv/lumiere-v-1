"use client"

import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  Grid3x3,
  List,
  Settings,
  Clock,
  MapPin,
  Users,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { CalendarEvent, ViewMode } from "../lib/calendar-types"
import { eventTypeConfig } from "../lib/calendar-types"
import { EventDetailPanel } from "./event-detail-panel"

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
}

export function CalendarView({
  events,
  viewMode,
  currentDate,
  selectedDate,
  searchTerm,
  selectedEventId,
  className,
  onViewModeChange,
  onPrevMonth,
  onNextMonth,
  onToday,
  onSelectDate,
  onSearchChange,
  onSelectEvent,
  onCreateEvent,
}: CalendarViewProps) {
  const filteredEvents = useMemo(
    () =>
      events?.filter(
        (event) =>
          event.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          event.description?.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    [events, searchTerm],
  )

  const getEventsForDate = (date: Date) =>
    filteredEvents.filter(
      (event) => new Date(event.startTime).toDateString() === date.toDateString(),
    )

  const renderMonthView = () => {
    const daysInMonth = new Date(currentDate?.getFullYear(), currentDate?.getMonth() + 1, 0)?.getDate()
    const firstDay = new Date(currentDate?.getFullYear(), currentDate?.getMonth(), 1)?.getDay()
    const days = []

    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="bg-muted/30 min-h-24 p-2" />)
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
      const dayEvents = getEventsForDate(date)
      const isSelected = selectedDate?.toDateString() === date.toDateString()
      const isToday = new Date().toDateString() === date.toDateString()

      days.push(
        <div
          key={day}
          onClick={() => onSelectDate(date)}
          onKeyDown={() => onSelectDate(date)}
          className={cn(
            "min-h-24 p-2 border rounded-lg cursor-pointer transition-colors",
            isSelected && "bg-primary/10 border-primary",
            isToday && !isSelected && "border-primary/50 bg-primary/5",
            !isSelected && !isToday && "border-border hover:bg-muted/50",
          )}
        >
          <div className="font-semibold text-sm mb-1">{day}</div>
          <div className="space-y-1">
            {dayEvents.slice(0, 2).map((event) => {
              const conf = eventTypeConfig[event.type]
              return (
                <div
                  key={event.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectEvent(event.id)
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    onSelectEvent(event.id)
                  }}
                  className={cn(
                    "text-xs p-1 rounded text-white truncate cursor-pointer hover:opacity-80 transition-opacity",
                    conf.color,
                  )}
                >
                  {event.title}
                </div>
              )
            })}
            {dayEvents.length > 2 && (
              <div className="text-xs text-muted-foreground px-1">
                +{dayEvents.length - 2} more
              </div>
            )}
          </div>
        </div>,
      )
    }

    return (
      <div className="grid grid-cols-7 gap-2 mb-6">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="text-center font-semibold text-sm py-2">
            {day}
          </div>
        ))}
        {days}
      </div>
    )
  }

  const renderEventsList = () => {
    const selectedDateEvents = selectedDate ? getEventsForDate(selectedDate) : []

    return (
      <div className="space-y-3">
        <div className="text-sm font-semibold text-muted-foreground">
          {selectedDate?.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </div>
        {selectedDateEvents.length > 0 ? (
          selectedDateEvents.map((event) => {
            const conf = eventTypeConfig[event.type]
            return (
              <div
                key={event.id}
                onClick={() => onSelectEvent(event.id)}
                className="border rounded-lg p-3 hover:bg-muted/50 cursor-pointer transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className={cn("w-2 h-2 rounded-full mt-2", conf.color)} />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm">{event.title}</h4>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                      <Clock className="w-3 h-3" />
                      {event.startTime.toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    {event.location && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <MapPin className="w-3 h-3" />
                        {event.location}
                      </div>
                    )}
                    {event.attendees.length > 0 && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <Users className="w-3 h-3" />
                        {event.attendees.length} attendees
                      </div>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs whitespace-nowrap">
                    {conf.label}
                  </Badge>
                </div>
              </div>
            )
          })
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <CalendarIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No events scheduled</p>
          </div>
        )}
      </div>
    )
  }

  const monthYear = currentDate?.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{monthYear}</h2>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search events..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-48"
          />
          <div className="flex gap-1 border rounded-lg p-1">
            <Button size="sm" variant={viewMode === "month" ? "default" : "ghost"} onClick={() => onViewModeChange("month")}>
              <Grid3x3 className="w-4 h-4" />
            </Button>
            <Button size="sm" variant={viewMode === "week" ? "default" : "ghost"} onClick={() => onViewModeChange("week")}>
              <CalendarIcon className="w-4 h-4" />
            </Button>
            <Button size="sm" variant={viewMode === "day" ? "default" : "ghost"} onClick={() => onViewModeChange("day")}>
              <List className="w-4 h-4" />
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={onToday}>Today</Button>
          <Button size="sm" className="gap-2" onClick={onCreateEvent}>
            <Plus className="w-4 h-4" />
            New Event
          </Button>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onPrevMonth}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={onNextMonth}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="text-sm font-semibold">{monthYear}</div>
        <Button size="sm" variant="ghost">
          <Settings className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 border rounded-lg p-4 bg-card">
          {renderMonthView()}
        </div>
        <div className="border rounded-lg p-4 bg-card max-h-[calc(100vh-14rem)] overflow-y-auto">
          {renderEventsList()}
        </div>
      </div>

      {selectedEventId && (
        <EventDetailPanel
          event={events.find((e) => e.id === selectedEventId)!}
          onClose={() => onSelectEvent(null)}
        />
      )}
    </div>
  )
}
