"use client"

import type { ComponentProps } from "react"
import { TabsList, TabsTrigger } from "./tabs"
import { cn } from "../lib/utils"
import { workspaceStyles } from "../lib/workspace-styles"

/** Shared secondary navigation for module views and record pages/drawers. */
export function ContextTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return <TabsList {...props} variant="line" data-ui="context-tabs" className={cn(
    "h-auto w-full flex-wrap justify-start gap-1 border-b border-border p-0 group-data-horizontal/tabs:h-auto", className,
  )} />
}

export function ContextTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return <TabsTrigger {...props} className={cn(workspaceStyles.tabTrigger, className)} />
}
