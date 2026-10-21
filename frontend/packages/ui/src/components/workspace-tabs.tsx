"use client"

import type { ComponentProps } from "react"
import { TabsList, TabsTrigger } from "./tabs"
import { cn } from "../lib/utils"
import { workspaceStyles } from "../lib/workspace-styles"

/** Same workspace appearance for small, locally controlled module shells. */
export function WorkspaceTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return <TabsList {...props} data-ui="workspace-nav" className={cn(
    workspaceStyles.workspaceNav, "h-auto w-full justify-start group-data-horizontal/tabs:h-auto", className,
  )} />
}

export function WorkspaceTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return <TabsTrigger {...props} className={cn(
    workspaceStyles.workspaceLink,
    "h-auto flex-none border-0 after:hidden data-active:bg-accent data-active:text-accent-foreground data-active:shadow-none data-active:ring-1 data-active:ring-primary/25 dark:data-active:bg-accent dark:data-active:text-accent-foreground",
    className,
  )} />
}
