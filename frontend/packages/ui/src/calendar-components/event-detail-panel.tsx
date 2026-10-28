"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Clock, MapPin, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CalendarEvent } from "../lib/calendar-types"
import { eventTypeConfig } from "../lib/calendar-types"
import { useTranslation } from "@lumiere/i18n"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/sheet"

interface EventDetailPanelProps {
  event: CalendarEvent
  onClose: () => void
  onEdit?: () => void
  onDelete?: () => void
  /** Where the event has a page of its own. */
  openHref?: string
}

export function EventDetailPanel({ event, onClose, onEdit, onDelete, openHref }: EventDetailPanelProps) {
  const { t, i18n } = useTranslation()
  const config = eventTypeConfig[event.type]

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="data-[side=right]:w-full overflow-y-auto p-4 sm:max-w-lg" showCloseButton={false}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={cn("w-3 h-3 rounded-full", config.color)}></div>
            <Badge variant="outline">{config.label}</Badge>
            {event.status === "cancelled" && <Badge variant="secondary">{t("calendar.workspace.cancelled", { defaultValue: "Cancelled" })}</Badge>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("calendar.eventDetail.closeAria")}
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <SheetHeader className="p-0">
          <SheetTitle className="break-words text-xl">{event.title}</SheetTitle>
          <SheetDescription>{event.description || t("calendar.workspace.eventDetails", { defaultValue: "Event details" })}</SheetDescription>
        </SheetHeader>

        <div className="space-y-3 text-sm mb-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span>
              {event.allDay ? t("calendar.workspace.allDay", { defaultValue: "All day" }) : null}
              {event.allDay ? " · " : ""}
              {event.allDay ? event.startTime.toLocaleDateString(i18n.language) : event.startTime.toLocaleString(i18n.language)} - {event.allDay ? event.endTime.toLocaleDateString(i18n.language) : event.endTime.toLocaleString(i18n.language)}
            </span>
          </div>
          {event.location && (
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <span>{event.location}</span>
            </div>
          )}
          {event.attendees.length > 0 && (
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span>{event.attendees.join(", ")}</span>
            </div>
          )}
        </div>

        {event.relatedTo && (
          <div className="bg-muted/50 rounded p-3 mb-4 text-sm">
            <div className="font-semibold text-xs text-muted-foreground uppercase mb-1">
              {t("calendar.eventDetail.relatedTo", { type: event.relatedTo.type })}
            </div>
            <div className="font-medium">{event.relatedTo.id}</div>
          </div>
        )}

        <div className="flex gap-2">
          <Button size="sm" className="min-h-11 flex-1" onClick={onEdit} disabled={!onEdit}>
            {t("calendar.eventDetail.edit")}
          </Button>
          <Button size="sm" variant="outline" className="min-h-11 flex-1" onClick={onDelete} disabled={!onDelete}>
            {t("calendar.eventDetail.delete")}
          </Button>
        </div>
        {openHref ? (
          <Button
            size="sm"
            variant="ghost"
            className="mt-2 min-h-11 w-full"
            nativeButton={false}
            render={<Link href={openHref} />}
            data-testid="calendar-event-open"
          >
            {t("calendar.eventDetail.open", { defaultValue: "Open" })}
          </Button>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
