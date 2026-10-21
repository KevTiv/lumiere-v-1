"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import { Eye, Pencil } from "lucide-react"
import { cn } from "../lib/utils"
import { InvoicePreview, type InvoicePreviewModel } from "./invoice-preview"

interface InvoiceComposerProps {
  /** The form: fields, lines, notes. */
  form: ReactNode
  /** What the preview shows; recomputed by the caller on every edit. */
  preview: InvoicePreviewModel
  className?: string
}

/**
 * Two panes — the form on the left, the live invoice sheet on the right — like a document editor.
 * Below the `lg` breakpoint the panes become a Form / Preview switch so the form keeps the full
 * phone width.
 */
export function InvoiceComposer({ form, preview, className }: InvoiceComposerProps) {
  const [pane, setPane] = useState<"form" | "preview">("form")
  return (
    <div className={cn("space-y-3", className)} data-testid="invoice-composer">
      <div className="flex gap-1 rounded-lg bg-muted p-1 lg:hidden" role="tablist" aria-label="Invoice pane">
        {([
          { id: "form", label: "Edit", icon: Pencil },
          { id: "preview", label: "Preview", icon: Eye },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pane === id}
            onClick={() => setPane(id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              pane === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className={cn("min-w-0", pane === "preview" && "hidden lg:block")}>{form}</div>
        <div className={cn("min-w-0 lg:sticky lg:top-0 lg:self-start", pane === "form" && "hidden lg:block")}>
          <InvoicePreview model={preview} />
        </div>
      </div>
    </div>
  )
}
