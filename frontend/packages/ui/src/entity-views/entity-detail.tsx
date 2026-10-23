"use client"

import { useMemo } from "react"
import { cn } from "../lib/utils"
import type { EntityDetailConfig, EntityDetailField, EntityRow } from "../lib/entity-view-types"
import { filterEntitySurface } from "../lib/entity-view-types"
import { useRBAC } from "../lib/rbac-context"
import { formatEntityFieldValue } from "../lib/entity-row-utils"
import { unwrapEntityValue } from "../lib/entity-row-values"
import { Separator } from "../components/separator"
import { MarkdownView } from "../components/markdown-view"
import { TooltipProvider } from "../components/tooltip"
import { InlineEditField } from "./inline-edit-field"

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
  if (type === "markdown") return <MarkdownView value={String(unwrapEntityValue(value))} />
  return formatEntityFieldValue(value, type, badgeVariants, badgeLabels)
}

function renderFieldValue(
  field: EntityDetailField,
  value: unknown,
  data: EntityRow,
): React.ReactNode {
  if (field.render) return field.render(value, data)
  // A markdown-edited field reads formatted even when its column type was not set to markdown.
  const type = field.inlineEdit?.kind === "markdown" ? "markdown" : field.type
  return formatDetailValue(value, type, field.badgeVariants, field.badgeLabels)
}

const widthClasses: Record<string, string> = {
  full: "col-span-full",
  "2/3": "col-span-full @md/entity-detail:col-span-8",
  "1/2": "col-span-full @md/entity-detail:col-span-6",
  "1/3": "col-span-full @md/entity-detail:col-span-4",
  "1/4": "col-span-full @md/entity-detail:col-span-3",
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
    <div
      className={cn(
        "@container/entity-detail min-w-0 space-y-8",
        "[&_[data-slot=badge]]:h-auto [&_[data-slot=badge]]:max-w-full [&_[data-slot=badge]]:whitespace-normal",
        className
      )}
    >
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
          <div className="grid grid-cols-1 gap-y-5 @md/entity-detail:grid-cols-12 @md/entity-detail:gap-x-6">
            {section.fields.map((field) => {
              const width = field.width ?? "1/2"
              const value = data[field.key]
              // Editors work on the plain value; an Option-wrapped cell still renders as stored.
              const plain = unwrapEntityValue(value)
              return (
                <div
                  key={field.key}
                  className={cn("min-w-0 [overflow-wrap:anywhere]", widthClasses[width])}
                >
                  <dt className="text-xs font-medium text-muted-foreground mb-1">
                    {field.label}
                  </dt>
                  <dd className="text-sm text-foreground">
                    {field.inlineEdit ? (
                      <InlineEditField
                        edit={field.inlineEdit}
                        record={data}
                        fieldKey={field.key}
                        label={field.label}
                        value={plain}
                        renderValue={(shown) => renderFieldValue(field, shown === plain ? value : shown, data)}
                      />
                    ) : (
                      renderFieldValue(field, value, data)
                    )}
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
