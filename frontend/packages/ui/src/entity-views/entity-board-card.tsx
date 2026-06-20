"use client"

import type { EntityBoardCardConfig, EntityColumn } from "../lib/entity-view-types"
import { formatEntityFieldValue, getRowField } from "../lib/entity-row-utils"

interface EntityBoardCardProps {
  row: Record<string, unknown>
  card: EntityBoardCardConfig
}

function renderFieldColumn(row: Record<string, unknown>, column: EntityColumn) {
  const value = getRowField(row, column.key)
  if (column.render) return column.render(value, row)
  return formatEntityFieldValue(value, column.type, column.badgeVariants, column.badgeLabels)
}

export function EntityBoardCard({ row, card }: EntityBoardCardProps) {
  if (card.render) {
    return <>{card.render(row)}</>
  }

  const title = String(getRowField(row, card.titleKey) ?? "—")

  return (
    <>
      <h4 className="text-sm font-medium text-foreground line-clamp-2 mb-2">{title}</h4>

      {card.fields && card.fields.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mb-2">
          {card.fields.map((field) => (
            <span key={field.key} className="inline-flex items-center gap-1">
              {field.label ? (
                <span className="sr-only">{field.label}</span>
              ) : null}
              {renderFieldColumn(row, field)}
            </span>
          ))}
        </div>
      ) : null}

      {card.footerFields && card.footerFields.length > 0 ? (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          {card.footerFields.map((field, index) => (
            <div key={field.key} className={index === 0 ? "min-w-0" : "shrink-0 ml-auto"}>
              {renderFieldColumn(row, field)}
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}
