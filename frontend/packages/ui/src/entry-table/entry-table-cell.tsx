"use client"

import { cn } from "@/lib/utils"
import type { TableColumn, EntryData } from "@/lib/entry-table-types"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ImageIcon, Check, X, Clock, AlertCircle, CheckCircle2, XCircle, MinusCircle } from "lucide-react"

interface EntryTableCellProps {
  column: TableColumn
  value: unknown
  row: EntryData
  imagePlaceholder?: string
}

export function EntryTableCell({
  column,
  value,
  row,
  imagePlaceholder,
}: EntryTableCellProps) {
  switch (column.type) {
    case "text": {
      const textCol = column
      const text = String(value ?? "")
      if (textCol.truncate && textCol.maxLength && text.length > textCol.maxLength) {
        return (
          <span className="text-foreground" title={text}>
            {text.slice(0, textCol.maxLength)}...
          </span>
        )
      }
      return <span className="text-foreground">{text || "-"}</span>
    }

    case "number": {
      const numCol = column
      if (value == null) return <span className="text-muted-foreground">-</span>
      const num = Number(value)
      const formatted = numCol.decimals !== undefined 
        ? num.toFixed(numCol.decimals) 
        : num.toLocaleString()
      return (
        <span className="text-foreground font-mono">
          {numCol.prefix}{formatted}{numCol.suffix}
        </span>
      )
    }

    case "date":
    case "datetime": {
      if (!value) return <span className="text-muted-foreground">-</span>
      const date = new Date(String(value))
      const formatted = column.type === "datetime"
        ? date.toLocaleString()
        : date.toLocaleDateString()
      return <span className="text-foreground">{formatted}</span>
    }

    case "currency": {
      const curCol = column
      if (value == null) return <span className="text-muted-foreground">-</span>
      const num = Number(value)
      const formatted = new Intl.NumberFormat(curCol.locale || "en-US", {
        style: "currency",
        currency: curCol.currency || "USD",
      }).format(num)
      return <span className="text-foreground font-mono">{formatted}</span>
    }

    case "image": {
      const imgCol = column
      const src = String(value || "")
      const sizeClasses = {
        sm: "h-8 w-8",
        md: "h-12 w-12",
        lg: "h-16 w-16",
      }
      const size = imgCol.size || "md"
      
      if (!src && !imagePlaceholder && !imgCol.fallback) {
        return (
          <div className={cn(
            sizeClasses[size],
            "bg-secondary/50 flex items-center justify-center",
            imgCol.rounded ? "rounded-full" : "rounded-md"
          )}>
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          </div>
        )
      }

      return (
        <div className={cn(
          sizeClasses[size],
          "relative overflow-hidden bg-secondary/50",
          imgCol.rounded ? "rounded-full" : "rounded-md"
        )}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src || imagePlaceholder || imgCol.fallback}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              const target = e.target as HTMLImageElement
              if (imgCol.fallback) {
                target.src = imgCol.fallback
              } else if (imagePlaceholder) {
                target.src = imagePlaceholder
              }
            }}
          />
        </div>
      )
    }

    case "avatar": {
      const avatarCol = column
      const src = String(value || "")
      const fallbackValue = avatarCol.fallbackKey ? String(row[avatarCol.fallbackKey] || "") : ""
      const initials = fallbackValue
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)

      const sizeClasses = {
        sm: "h-8 w-8 text-xs",
        md: "h-10 w-10 text-sm",
        lg: "h-12 w-12 text-base",
      }
      const size = avatarCol.size || "md"

      return (
        <Avatar className={sizeClasses[size]}>
          <AvatarImage src={src || imagePlaceholder} alt={fallbackValue} />
          <AvatarFallback className="bg-primary/20 text-primary">
            {initials || "?"}
          </AvatarFallback>
        </Avatar>
      )
    }

    case "badge": {
      const badgeCol = column
      const strVal = String(value || "")
      const variant = badgeCol.variants?.[strVal]
      
      const colorClasses = {
        default: "bg-secondary text-secondary-foreground",
        primary: "bg-primary/20 text-primary border-primary/30",
        secondary: "bg-secondary text-secondary-foreground",
        success: "bg-green-500/20 text-green-400 border-green-500/30",
        warning: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
        danger: "bg-red-500/20 text-red-400 border-red-500/30",
        info: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      }

      return (
        <Badge
          variant="outline"
          className={cn(
            "font-medium",
            variant ? colorClasses[variant.color] : colorClasses.default
          )}
        >
          {variant?.label || strVal}
        </Badge>
      )
    }

    case "status": {
      const statusCol = column
      const strVal = String(value || "")
      const status = statusCol.statuses[strVal]
      
      if (!status) {
        return <span className="text-muted-foreground">{strVal || "-"}</span>
      }

      const colorClasses = {
        green: "text-green-400",
        yellow: "text-yellow-400",
        red: "text-red-400",
        blue: "text-blue-400",
        gray: "text-gray-400",
        purple: "text-purple-400",
        orange: "text-orange-400",
      }

      const dotColors = {
        green: "bg-green-400",
        yellow: "bg-yellow-400",
        red: "bg-red-400",
        blue: "bg-blue-400",
        gray: "bg-gray-400",
        purple: "bg-purple-400",
        orange: "bg-orange-400",
      }

      const icons = {
        check: CheckCircle2,
        x: XCircle,
        clock: Clock,
        alert: AlertCircle,
        minus: MinusCircle,
      }

      const IconComponent = status.icon ? icons[status.icon as keyof typeof icons] : null

      return (
        <div className={cn("flex items-center gap-2", colorClasses[status.color])}>
          {IconComponent ? (
            <IconComponent className="h-4 w-4" />
          ) : (
            <span className={cn("h-2 w-2 rounded-full", dotColors[status.color])} />
          )}
          <span className="text-sm font-medium">{status.label}</span>
        </div>
      )
    }

    case "progress": {
      const progCol = column
      const current = Number(value || 0)
      const max = progCol.maxKey ? Number(row[progCol.maxKey] || 100) : 100
      const percent = Math.round((current / max) * 100)

      const colorClasses = {
        primary: "[&>div]:bg-primary",
        success: "[&>div]:bg-green-500",
        warning: "[&>div]:bg-yellow-500",
        danger: "[&>div]:bg-red-500",
      }

      return (
        <div className="flex items-center gap-3 min-w-24">
          <Progress
            value={percent}
            className={cn("h-2 flex-1", colorClasses[progCol.color || "primary"])}
          />
          {progCol.showLabel && (
            <span className="text-xs text-muted-foreground font-mono w-10">
              {percent}%
            </span>
          )}
        </div>
      )
    }

    case "custom": {
      const customCol = column
      return <>{customCol.render(value, row)}</>
    }

    default:
      return <span className="text-foreground">{String(value ?? "-")}</span>
  }
}
