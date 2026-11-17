import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { Badge } from "../components/badge"
import { cn } from "../lib/utils"

const statusVariants = {
  neutral: "outline",
  working: "secondary",
  success: "success",
  warning: "warning",
  error: "destructive",
} as const

type AssistantActionStatus = {
  label: string
  tone?: keyof typeof statusVariants
}

interface AssistantActionCardProps {
  title: ReactNode
  status?: AssistantActionStatus
  description?: ReactNode
  primaryAction?: ReactNode
  children?: ReactNode
  busy?: boolean
  className?: string
  testId?: string
  ariaLabel?: string
}

export function AssistantActionCard({
  title,
  status,
  description,
  primaryAction,
  children,
  busy,
  className,
  testId,
  ariaLabel,
}: AssistantActionCardProps) {
  return (
    <section
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        "w-full min-w-0 space-y-3 rounded-xl border border-border bg-card p-3 text-sm [overflow-wrap:anywhere]",
        className,
      )}
    >
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <h3 className="min-w-0 flex-1 text-sm font-medium leading-5">
            {title}
          </h3>
          {status ? (
            <Badge
              variant={statusVariants[status.tone ?? "neutral"]}
              role="status"
              className="h-auto max-w-full whitespace-normal"
            >
              {status.tone === "working" ? (
                <Loader2
                  aria-hidden="true"
                  className="shrink-0 motion-safe:animate-spin"
                />
              ) : null}
              {status.label}
            </Badge>
          ) : null}
        </div>
        {description ? (
          <div className="text-sm leading-5 text-muted-foreground">
            {description}
          </div>
        ) : null}
      </header>
      {children}
      {primaryAction ? (
        <div
          aria-busy={busy}
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          {primaryAction}
        </div>
      ) : null}
    </section>
  )
}
