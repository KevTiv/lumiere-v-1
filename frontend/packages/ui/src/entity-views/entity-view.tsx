import { cn } from "../lib/utils"
import type { EntityViewConfig } from "../lib/entity-view-types"
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
