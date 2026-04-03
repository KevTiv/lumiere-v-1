"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Clock, MapPin, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CalendarEvent } from "@lumiere/ui"
import { eventTypeConfig } from "@lumiere/ui"
import { useTranslation } from "@lumiere/i18n"

interface EventDetailPanelProps {
  event: CalendarEvent
  onClose: () => void
  onEdit?: () => void
  onDelete?: () => void
}

export function EventDetailPanel({ event, onClose, onEdit, onDelete }: EventDetailPanelProps) {
  const { t, i18n } = useTranslation()
  const config = eventTypeConfig[event.type]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={cn("w-3 h-3 rounded-full", config.color)}></div>
            <Badge variant="outline">{config.label}</Badge>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("calendar.eventDetail.closeAria")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            ✕
          </button>
        </div>

        <h3 className="text-xl font-bold mb-2">{event.title}</h3>
        {event.description && (
          <p className="text-sm text-muted-foreground mb-4">{event.description}</p>
        )}

        <div className="space-y-3 text-sm mb-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span>
              {event.startTime.toLocaleString(i18n.language)} — {event.endTime.toLocaleString(i18n.language)}
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
          <Button size="sm" className="flex-1" onClick={onEdit} disabled={!onEdit}>
            {t("calendar.eventDetail.edit")}
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={onDelete} disabled={!onDelete}>
            {t("calendar.eventDetail.delete")}
          </Button>
        </div>
      </div>
    </div>
  )
}
