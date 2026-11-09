"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Clock, MapPin, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CalendarEvent } from "../lib/calendar-types"
import { eventTypeConfig } from "../lib/calendar-types"
import { useTranslation } from "@lumiere/i18n"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../components/sheet"

interface EventDetailPanelProps {
  event: CalendarEvent
  timeZone?: string
  onClose: () => void
  onEdit?: () => void
  onDelete?: () => void
  /** Where the event has a page of its own. */
  openHref?: string
}

export function EventDetailPanel({
  event,
  timeZone,
  onClose,
  onEdit,
  onDelete,
  openHref,
}: EventDetailPanelProps) {
  const { t, i18n } = useTranslation()
  const config = eventTypeConfig[event.type]
  const displayedEnd =
    event.allDay && event.endTime > event.startTime
      ? new Date(event.endTime.getTime() - 1)
      : event.endTime
  const formatDate = (date: Date) =>
    event.allDay
      ? date.toLocaleDateString(i18n.language, { timeZone })
      : date.toLocaleString(i18n.language, { timeZone })
  const startLabel = formatDate(event.startTime)
  const endLabel = formatDate(displayedEnd)

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent size="record" className="gap-0">
        <SheetHeader className="shrink-0 border-b">
          <SheetTitle className="text-xl [overflow-wrap:anywhere]">
            {event.title}
          </SheetTitle>
          <SheetDescription>
            {timeZone
              ? t("calendar.workspace.detailTimezone", {
                  defaultValue: "Times shown in {{timezone}}",
                  timezone: timeZone,
                })
              : t("calendar.workspace.eventDetails", {
                  defaultValue: "Event details",
                })}
          </SheetDescription>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              <span
                className={cn("size-2 rounded-full", config.color)}
                aria-hidden="true"
              />
              {config.label}
            </Badge>
            {event.status === "cancelled" && (
              <Badge variant="secondary">
                {t("calendar.workspace.cancelled", {
                  defaultValue: "Cancelled",
                })}
              </Badge>
            )}
          </div>
        </SheetHeader>
        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 text-sm [overflow-wrap:anywhere]">
          <div className="flex items-center gap-2">
            <Clock
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span>
              {event.allDay && (
                <>
                  {t("calendar.workspace.allDay", { defaultValue: "All day" })}{" "}
                  ·{" "}
                </>
              )}
              {startLabel}
              {startLabel !== endLabel && ` – ${endLabel}`}
            </span>
          </div>
          {event.location && (
            <div className="flex items-center gap-2">
              <MapPin
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span>{event.location}</span>
            </div>
          )}
          {event.attendees.length > 0 && (
            <div className="flex items-center gap-2">
              <Users
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="font-medium">
                  {t("calendar.eventDetail.attendees", {
                    defaultValue: "Attendees",
                  })}
                </p>
                <p>{event.attendees.join(", ")}</p>
              </div>
            </div>
          )}
          {event.description && (
            <div className="space-y-1">
              <h3 className="font-medium">
                {t("calendar.forms.newEvent.fields.description", {
                  defaultValue: "Description",
                })}
              </h3>
              <p className="whitespace-pre-wrap">{event.description}</p>
            </div>
          )}
          {event.relatedTo && (
            <div className="space-y-1">
              <h3 className="font-medium">
                {t("calendar.eventDetail.relatedTo", {
                  type: event.relatedTo.type,
                })}
              </h3>
              <p>{event.relatedTo.id}</p>
            </div>
          )}
        </div>
        <SheetFooter className="shrink-0 flex-row flex-wrap items-center border-t">
          {openHref && (
            <Button
              size="sm"
              className="min-h-11"
              nativeButton={false}
              render={<Link href={openHref} />}
              data-testid="calendar-event-open"
            >
              {t("calendar.eventDetail.open", { defaultValue: "Open event" })}
            </Button>
          )}
          <Button
            size="sm"
            variant={openHref ? "outline" : "default"}
            className="min-h-11"
            onClick={onEdit}
            disabled={!onEdit}
          >
            {t("calendar.eventDetail.edit")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11"
            onClick={onDelete}
            disabled={!onDelete}
          >
            {t("calendar.eventDetail.delete")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
