import React from "react"

import { cn } from "@lumiere/ui/lib/utils"
import { workspaceStyles } from "../lib/workspace-styles"

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        workspaceStyles.surface,
        "group/card flex min-w-0 max-w-full [overflow-wrap:anywhere] flex-col gap-4 overflow-hidden py-4 text-sm has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header min-w-0 grid auto-rows-min items-start gap-1 rounded-t-xl px-4 group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_fit-content(50%)] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "col-start-1 min-w-0 max-w-full [overflow-wrap:anywhere] text-base leading-snug font-semibold tracking-[-0.01em] group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("col-start-1 min-w-0 max-w-full [overflow-wrap:anywhere] text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "min-w-0 max-w-full [overflow-wrap:anywhere] col-start-2 row-span-2 row-start-1 self-start justify-self-end @max-[20rem]/card-header:col-start-1 @max-[20rem]/card-header:row-span-1 @max-[20rem]/card-header:row-start-auto @max-[20rem]/card-header:justify-self-start [&>button]:h-auto [&>button]:max-w-full [&>button]:whitespace-normal [&>a]:max-w-full [&>a]:whitespace-normal",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("min-w-0 max-w-full [overflow-wrap:anywhere] px-4 group-data-[size=sm]/card:px-3", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "min-w-0 max-w-full [overflow-wrap:anywhere] flex flex-wrap items-center gap-2 rounded-b-xl border-t bg-muted/30 p-4 group-data-[size=sm]/card:p-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
