import type { ReactNode } from "react"
import { Badge } from "../components/badge"
import { Avatar, AvatarFallback, AvatarImage } from "../components/avatar"
import { Progress } from "../components/progress"
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/tooltip"
import { cn } from "./utils"
import { entryTableStatusDotClass } from "./theme-colors"
import type { EntityViewConfig } from "./entity-view-types"

/** Read a row field supporting camelCase and snake_case keys. */
export function getRowField(row: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row, key)) return row[key]
  const snake = key.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "")
  if (Object.prototype.hasOwnProperty.call(row, snake)) return row[snake]
  const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  if (Object.prototype.hasOwnProperty.call(row, camel)) return row[camel]
  return undefined
}

export function getEntityRowKey(config: EntityViewConfig): string | undefined {
  const view = config.view
  if (view.mode === "table") return view.rowKey
  if (view.mode === "table-or-board") return view.table.rowKey ?? view.board.rowKey
  if (view.mode === "board") return view.rowKey
  return undefined
}

export function formatTimestampLike(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (value != null && typeof value === "object" && "microsSinceUnixEpoch" in value) {
    const micros = BigInt(String((value as { microsSinceUnixEpoch: unknown }).microsSinceUnixEpoch))
    return new Date(Number(micros / 1000n))
  }
  return null
}

function formatRelativeTime(date: Date): string {
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000)
  const absSec = Math.abs(diffSec)
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

  if (absSec < 60) return rtf.format(Math.round(diffSec), "second")
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), "minute")
  if (absSec < 86400) return rtf.format(Math.round(diffSec / 3600), "hour")
  if (absSec < 2592000) return rtf.format(Math.round(diffSec / 86400), "day")
  if (absSec < 31536000) return rtf.format(Math.round(diffSec / 2592000), "month")
  return rtf.format(Math.round(diffSec / 31536000), "year")
}

function statusDotClass(variantKey: string): string {
  return (
    entryTableStatusDotClass[variantKey] ??
    {
      default: "bg-primary",
      secondary: "bg-muted-foreground",
      destructive: "bg-destructive",
      outline: "bg-muted-foreground",
      success: "bg-success",
      warning: "bg-warning",
      info: "bg-info",
    }[variantKey] ??
    "bg-muted-foreground"
  )
}

function avatarInitials(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function isLikelyImageSrc(value: string): boolean {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("/") ||
    value.startsWith("data:")
  )
}

export function formatEntityFieldValue(
  value: unknown,
  type: string | undefined,
  badgeVariants?: Record<string, string>,
  badgeLabels?: Record<string, string>,
): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>
  }

  switch (type) {
    case "currency":
      return typeof value === "number"
        ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)
        : String(value)

    case "number":
      return typeof value === "number"
        ? new Intl.NumberFormat("en-US").format(value)
        : String(value)

    case "percent":
      return typeof value === "number" ? `${value.toFixed(1)}%` : String(value)

    case "date": {
      const d = formatTimestampLike(value)
      return d ? d.toLocaleDateString() : String(value)
    }

    case "datetime": {
      const d = formatTimestampLike(value)
      return d ? d.toLocaleString() : String(value)
    }

    case "relative-date": {
      const d = formatTimestampLike(value)
      if (!d) return String(value)
      const relative = formatRelativeTime(d)
      const full = d.toLocaleString()
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default">{relative}</span>
          </TooltipTrigger>
          <TooltipContent>{full}</TooltipContent>
        </Tooltip>
      )
    }

    case "boolean":
      return (
        <Badge variant={value ? "default" : "secondary"}>
          {value ? "Yes" : "No"}
        </Badge>
      )

    case "badge": {
      const raw = String(value)
      const variant = (badgeVariants?.[raw] ?? "secondary") as
        | "default"
        | "secondary"
        | "destructive"
        | "outline"
      const label = badgeLabels?.[raw] ?? raw
      return <Badge variant={variant}>{label}</Badge>
    }

    case "status": {
      const raw = String(value)
      const variantKey = badgeVariants?.[raw] ?? "secondary"
      const label = badgeLabels?.[raw] ?? raw
      return (
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", statusDotClass(variantKey))} />
          <span className="text-sm font-medium">{label}</span>
        </div>
      )
    }

    case "avatar": {
      const raw = String(value)
      const src = isLikelyImageSrc(raw) ? raw : ""
      const name = badgeLabels?.[raw] ?? (src ? "" : raw)
      const initials = name ? avatarInitials(name) : avatarInitials(raw)
      return (
        <Avatar size="sm">
          {src ? <AvatarImage src={src} alt={name || raw} /> : null}
          <AvatarFallback className="bg-primary/20 text-primary">
            {initials || "?"}
          </AvatarFallback>
        </Avatar>
      )
    }

    case "progress": {
      const num = typeof value === "number" ? value : Number(value)
      const percent = Number.isFinite(num) ? Math.min(100, Math.max(0, num)) : 0
      return (
        <div className="flex min-w-24 items-center gap-2">
          <Progress value={percent} className="h-2 min-w-0 flex-1 gap-0" />
          <span className="w-10 text-xs tabular-nums text-muted-foreground">
            {Math.round(percent)}%
          </span>
        </div>
      )
    }

    default:
      return String(value)
  }
}