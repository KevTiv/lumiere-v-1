"use client"

import { useMemo } from "react"
import { cn } from "../lib/utils"
import type { EntityDetailConfig } from "../lib/entity-view-types"
import { filterEntitySurface } from "../lib/entity-view-types"
import { useRBAC } from "../lib/rbac-context"
import { formatEntityFieldValue } from "../lib/entity-row-utils"
import { unwrapEntityValue } from "../lib/entity-row-values"
import { Separator } from "../components/separator"
import { TooltipProvider } from "../components/tooltip"

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
  // Same formatting as table cells, so a record reads identically in both.
  if (unwrapEntityValue(value) == null || unwrapEntityValue(value) === "") {
    return <span className="text-muted-foreground italic">—</span>
  }
  return formatEntityFieldValue(value, type, badgeVariants, badgeLabels)
}

const widthClasses: Record<string, string> = {
  full: "col-span-12",
  "2/3": "col-span-12 md:col-span-8",
  "1/2": "col-span-12 md:col-span-6",
  "1/3": "col-span-12 md:col-span-4",
  "1/4": "col-span-12 md:col-span-3",
}

export function EntityDetail({ config, data, className }: EntityDetailProps) {
  const { checkPermission } = useRBAC()

  const sections = useMemo(
    () =>
      config.sections
        .map((section) => ({
          ...section,
          fields: filterEntitySurface(section.fields, checkPermission),
        }))
        .filter((section) => section.fields.length > 0),
    [config.sections, checkPermission],
  )

  return (
    // Shared cell formatting can render tooltips (e.g. relative dates).
    <TooltipProvider>
    <div className={cn("space-y-8", className)}>
      {sections.map((section, sectionIndex) => (
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
    </TooltipProvider>
  )
}
