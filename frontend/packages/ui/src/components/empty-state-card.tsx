import type { ReactNode } from "react"

import { cn } from "@lumiere/ui/lib/utils"
import { Button } from "./button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./empty"

export interface EmptyStateCardAction {
  label: string
  onClick: () => void
  icon?: ReactNode
  disabled?: boolean
  testId?: string
}

export interface EmptyStateCardProps {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** The one thing to do next. */
  primaryAction?: EmptyStateCardAction
  /** A lesser alternative, e.g. "Import CSV". */
  secondaryAction?: EmptyStateCardAction
  /** "Learn how" line shown under the buttons. */
  hint?: ReactNode
  /** Shown instead of the buttons when the user may not create records. */
  readOnlyMessage?: ReactNode
  /** Smaller padding and type for sub-tabs and side panels. */
  compact?: boolean
  className?: string
  "data-testid"?: string
}

/** Onboarding empty state: icon, why it matters, and what to do first. */
export function EmptyStateCard({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  hint,
  readOnlyMessage,
  compact = false,
  className,
  "data-testid": testId,
}: EmptyStateCardProps) {
  const hasButtons = primaryAction != null || secondaryAction != null
  return (
    <Empty
      className={cn("border-0", compact ? "gap-3 py-6" : "py-12", className)}
      data-testid={testId}
      data-compact={compact || undefined}
    >
      <EmptyHeader>
        {icon ? <EmptyMedia variant="icon">{icon}</EmptyMedia> : null}
        <EmptyTitle className={compact ? undefined : "text-base"}>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {hasButtons || hint || readOnlyMessage ? (
        <EmptyContent>
          {hasButtons ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {primaryAction ? (
                <Button
                  size="sm"
                  disabled={primaryAction.disabled}
                  onClick={primaryAction.onClick}
                  data-testid={primaryAction.testId ?? "entity-empty-cta"}
                >
                  {primaryAction.icon}
                  {primaryAction.label}
                </Button>
              ) : null}
              {secondaryAction ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={secondaryAction.disabled}
                  onClick={secondaryAction.onClick}
                  data-testid={secondaryAction.testId ?? "entity-empty-secondary-cta"}
                >
                  {secondaryAction.icon}
                  {secondaryAction.label}
                </Button>
              ) : null}
            </div>
          ) : null}
          {readOnlyMessage && !primaryAction ? (
            <p className="text-xs text-muted-foreground" data-testid="entity-empty-read-only">
              {readOnlyMessage}
            </p>
          ) : null}
          {hint ? (
            <p className="text-xs text-muted-foreground" data-testid="entity-empty-hint">
              {hint}
            </p>
          ) : null}
        </EmptyContent>
      ) : null}
    </Empty>
  )
}
