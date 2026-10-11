"use client"

import Link from "next/link"
import { Bell } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "../components/button"
import { Popover, PopoverContent, PopoverTrigger } from "../components/popover"
import type { BellNotification } from "../lib/notification-bell-model"

/**
 * Bell with an unread count and recipient-owned acknowledgement actions.
 */
export function NotificationBell({
  notifications,
  viewAllHref,
  itemHref,
  onNotificationOpen,
  onMarkAllRead,
  isMarkingRead = false,
}: {
  notifications: ReadonlyArray<BellNotification>
  viewAllHref: string
  itemHref: (notification: BellNotification) => string
  onNotificationOpen?: (notification: BellNotification) => void | Promise<void>
  onMarkAllRead?: () => void | Promise<void>
  isMarkingRead?: boolean
}) {
  const { t, i18n } = useTranslation()
  const count = notifications.length
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            className="relative"
            aria-label={t("notifications.bell.label", { defaultValue: "Notifications" })}
            data-testid="notification-bell"
          />
        }
      >
        <Bell className="h-4 w-4" />
        {count > 0 ? (
          <span
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white"
            data-testid="notification-bell-count"
          >
            {count}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80" data-testid="notification-bell-popover">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("notifications.bell.unread", { defaultValue: "Unread notifications" })}
          </p>
          {count > 0 && onMarkAllRead ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={isMarkingRead}
              onClick={() => void onMarkAllRead()}
              data-testid="notification-bell-mark-all"
            >
              {t("notifications.bell.markAllRead", { defaultValue: "Mark all read" })}
            </Button>
          ) : null}
        </div>
        {count === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="notification-bell-empty">
            {t("notifications.bell.empty", { defaultValue: "No notifications." })}
          </p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {notifications.map((n) => (
              <li key={n.id}>
                <Link
                  href={itemHref(n)}
                  className="block rounded-md px-2 py-1.5 hover:bg-muted"
                  data-testid={`notification-bell-item-${n.id}`}
                  onClick={() => void onNotificationOpen?.(n)}
                >
                  <span className="block truncate text-sm">{n.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {n.dateMs ? new Date(n.dateMs).toLocaleString(i18n.language) : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href={viewAllHref} className="text-sm text-primary hover:underline" data-testid="notification-bell-view-all">
          {t("notifications.bell.viewAll", { defaultValue: "View all" })}
        </Link>
      </PopoverContent>
    </Popover>
  )
}
