import type { ReactNode } from "react"
import { Badge } from "../components/badge"
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

function formatTimestampLike(value: unknown): Date | null {
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

    default:
      return String(value)
  }
}
