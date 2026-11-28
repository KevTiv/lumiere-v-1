"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { cn } from "../lib/utils"
import { MicroTooltip } from "./contextual-help"

export type DocumentChainTone = "default" | "success" | "warning" | "destructive" | "info"

export interface DocumentChainItem {
  id: string
  /** Short record type label, e.g. "Order", "Delivery", "Invoice", "Payment". */
  kind: string
  /** Human-readable reference, e.g. "SO-0042" or "INV/2026/0012". */
  reference: string
  /** Optional status label shown in tooltip and reflected in the status dot. */
  status?: string
  tone?: DocumentChainTone
  /** Navigation target; omit for the currently open record. */
  href?: string
  /** True for the currently viewed record in the chain. */
  current?: boolean
}

export interface DocumentChainProps {
  items: ReadonlyArray<DocumentChainItem>
  className?: string
  testId?: string
}

const dotClass: Record<DocumentChainTone, string> = {
  default: "bg-muted-foreground/60",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  destructive: "bg-destructive",
  info: "bg-sky-500",
}

/**
 * Pill-based upstream → current → downstream document trail for ERP handoffs
 * (e.g. Quote → Sale Order → Delivery → Invoice → Payment).
 */
export function DocumentChain({
  items,
  className,
  testId = "document-chain",
}: DocumentChainProps) {
  if (items.length === 0) return null

  return (
    <nav
      aria-label="Linked documents"
      data-testid={testId}
      className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}
    >
      {items.map((item, index) => {
        const pillContent = (
          <>
            <span
              className={cn("size-1.5 shrink-0 rounded-full", dotClass[item.tone ?? "default"])}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{item.kind}</span>
            <span className="font-mono font-medium text-foreground">{item.reference}</span>
          </>
        )

        const pillClass = cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors",
          item.current
            ? "border-primary/40 bg-primary/8 text-foreground shadow-2xs"
            : item.href
              ? "border-border/70 bg-background hover:border-border hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              : "border-border/60 bg-muted/30 text-muted-foreground",
        )

        const element = item.href && !item.current ? (
          <Link href={item.href} className={pillClass}>
            {pillContent}
          </Link>
        ) : (
          <span className={pillClass} aria-current={item.current ? "page" : undefined}>
            {pillContent}
          </span>
        )

        return (
          <React.Fragment key={item.id}>
            {index > 0 && (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
            )}
            {item.status ? (
              <MicroTooltip content={`${item.kind} ${item.reference} · ${item.status}`}>
                {element}
              </MicroTooltip>
            ) : (
              element
            )}
          </React.Fragment>
        )
      })}
    </nav>
  )
}
