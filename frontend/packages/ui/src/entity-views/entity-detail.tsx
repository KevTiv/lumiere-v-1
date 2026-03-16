"use client"

import { cn } from "../lib/utils"
import type { EntityDetailConfig } from "../lib/entity-view-types"
import { Badge } from "../components/badge"
import { Separator } from "../components/separator"

interface EntityDetailProps {
  config: EntityDetailConfig
  data: Record<string, unknown>
  className?: string
}

function formatDetailValue(
  value: unknown,
  type: string | undefined,
  badgeVariants?: Record<string, string>,
  badgeLabels?: Record<string, string>,
): React.ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground italic">—</span>
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
      return typeof value === "number" ? `${value.toFixed(2)}%` : String(value)

    case "date":
      return value instanceof Date
        ? value.toLocaleDateString()
        : typeof value === "string"
          ? new Date(value).toLocaleDateString()
          : String(value)

    case "datetime":
      return value instanceof Date
        ? value.toLocaleString()
        : typeof value === "string"
          ? new Date(value).toLocaleString()
          : String(value)

    case "boolean":
      return (
        <Badge variant={value ? "default" : "secondary"}>
          {value ? "Yes" : "No"}
        </Badge>
      )

    case "badge": {
      const raw = String(value)
      const variant = (badgeVariants?.[raw] ?? "secondary") as "default" | "secondary" | "destructive" | "outline"
      const label = badgeLabels?.[raw] ?? raw
      return <Badge variant={variant}>{label}</Badge>
    }

    default:
      return String(value)
  }
}

const widthClasses: Record<string, string> = {
  full: "col-span-12",
  "2/3": "col-span-12 md:col-span-8",
  "1/2": "col-span-12 md:col-span-6",
  "1/3": "col-span-12 md:col-span-4",
  "1/4": "col-span-12 md:col-span-3",
}

export function EntityDetail({ config, data, className }: EntityDetailProps) {
  return (
    <div className={cn("space-y-8", className)}>
      {config.sections.map((section, sectionIndex) => (
        <div key={section.id}>
          {sectionIndex > 0 && <Separator className="mb-8" />}
          {(section.title || section.description) && (
            <div className="mb-4 space-y-1">
              {section.title && (
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                  {section.title}
                </h3>
              )}
              {section.description && (
                <p className="text-sm text-muted-foreground">{section.description}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-12 gap-x-6 gap-y-5">
            {section.fields.map((field) => {
              const width = field.width ?? "1/2"
              const value = data[field.key]
              return (
                <div key={field.key} className={widthClasses[width]}>
                  <dt className="text-xs font-medium text-muted-foreground mb-1">
                    {field.label}
                  </dt>
                  <dd className="text-sm text-foreground">
                    {field.render
                      ? field.render(value, data)
                      : formatDetailValue(value, field.type, field.badgeVariants, field.badgeLabels)}
                  </dd>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
