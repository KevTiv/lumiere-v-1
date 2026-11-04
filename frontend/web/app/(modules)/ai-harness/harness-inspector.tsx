"use client"

import type { ReactNode } from "react"
import { useTranslation } from "@lumiere/i18n"

/** Presentation only: content stays mounted; server authorization remains authoritative. */
export function HarnessInspector({ title, description, children, open, onOpenChange }: {
  title?: string
  description?: string
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <details open={open} onToggle={onOpenChange ? (event) => onOpenChange(event.currentTarget.open) : undefined} className="min-w-0 rounded-xl border bg-card px-4 py-2" data-testid="harness-inspector">
      <summary className="min-h-11 cursor-pointer content-center rounded-md py-2 text-sm font-medium [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {title ?? t("aiHarness.inspector.title", { defaultValue: "Technical inspector" })}
      </summary>
      <div className="flex min-w-0 flex-col gap-4 py-3 [overflow-wrap:anywhere] [&_code]:whitespace-normal [&_input]:min-w-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto">
        <p className="text-xs leading-5 text-muted-foreground">{description ?? t("aiHarness.inspector.description", { defaultValue: "Identifiers and diagnostic details for support and advanced review. Opening this section does not run an action or change access." })}</p>
        {children}
      </div>
    </details>
  )
}
