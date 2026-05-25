"use client"

import { useMemo } from "react"
import { cn } from "../lib/utils"
import type {
  EntityDetailConfig,
  EntityPermissioned,
  EntityTableConfig,
  EntityViewConfig,
} from "../lib/entity-view-types"
import { filterEntitySurface } from "../lib/entity-view-types"
import { useRBAC } from "../lib/rbac-context"
import { EntityTable } from "./entity-table"
import { EntityDetail } from "./entity-detail"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/card"

interface EntityViewProps {
  config: EntityViewConfig
  /** Array of records for table mode */
  data?: Record<string, unknown>[]
  /** Single record for detail mode */
  record?: Record<string, unknown>
  /** Wrap in a Card (default: true) */
  useCard?: boolean
  onRowClick?: (row: Record<string, unknown>) => void
  className?: string
}

/** Filter permissioned entity UI items using the current RBAC context. */
export function useEntitySurfaceFilter<T extends EntityPermissioned>(
  items: T[] | undefined,
): T[] {
  const { checkPermission } = useRBAC()
  return useMemo(
    () => filterEntitySurface(items, checkPermission),
    [items, checkPermission],
  )
}

/** Apply RBAC filtering to table columns and toolbar actions. */
export function useScopedEntityTableConfig(config: EntityTableConfig): EntityTableConfig {
  const columns = useEntitySurfaceFilter(config.columns)
  const actions = useEntitySurfaceFilter(config.actions)
  return useMemo(
    () => ({
      ...config,
      columns,
      actions: actions.length > 0 ? actions : undefined,
    }),
    [config, columns, actions],
  )
}

/** Apply RBAC filtering to detail sections and fields; drops empty sections. */
export function useScopedEntityDetailConfig(config: EntityDetailConfig): EntityDetailConfig {
  const { checkPermission } = useRBAC()
  return useMemo(
    () => ({
      ...config,
      sections: config.sections
        .map((section) => ({
          ...section,
          fields: filterEntitySurface(section.fields, checkPermission),
        }))
        .filter((section) => section.fields.length > 0),
    }),
    [config, checkPermission],
  )
}

export function EntityView({
  config,
  data = [],
  record = {},
  useCard = true,
  onRowClick,
  className,
}: EntityViewProps) {
  const content =
    config.view.mode === "table" ? (
      <EntityTable
        config={config.view}
        data={data}
        onRowClick={onRowClick}
      />
    ) : (
      <EntityDetail config={config.view} data={record} />
    )

  if (!useCard) {
    return (
      <div className={cn("space-y-4", className)}>
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-foreground">{config.title}</h2>
          {config.description && (
            <p className="text-sm text-muted-foreground">{config.description}</p>
          )}
        </div>
        {content}
      </div>
    )
  }

  return (
    <Card className={cn("bg-card border-border/50", className)}>
      <CardHeader>
        <CardTitle>{config.title}</CardTitle>
        {config.description && <CardDescription>{config.description}</CardDescription>}
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}
