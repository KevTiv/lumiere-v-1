"use client"

import * as React from "react"

import { cn } from "@lumiere/ui/lib/utils"
import { TablePager, usePagedRows } from "./table-pager"

function tableChildren(children: React.ReactNode, prefix = ""): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((child) =>
    React.isValidElement<{ children?: React.ReactNode }>(child) && child.type === React.Fragment
      ? tableChildren(child.props.children, `${prefix}${child.key}/`)
      : [React.isValidElement(child) && prefix ? React.cloneElement(child, { key: `${prefix}${child.key}` }) : child],
  )
}

/** Tables page at 25 rows unless their owner supplies its own pagination. */
interface TableProps extends React.ComponentProps<"table"> {
  pagination?: boolean
  /** Keeps dense collections within the viewport and pins their column headings. */
  bounded?: boolean
  viewportLabel?: string
  viewportRef?: React.Ref<HTMLDivElement>
}

function Table({ className, children, pagination = true, bounded, viewportLabel, viewportRef, ...props }: TableProps) {
  const parts = tableChildren(children)
  const bodies = parts.filter((part): part is React.ReactElement<React.ComponentProps<typeof TableBody>> =>
    React.isValidElement(part) && part.type === TableBody,
  )
  const rows = bodies.flatMap((body) => tableChildren(body.props.children))
  // Keep the current page when cell values change; reset when row membership/order changes.
  const rowKey = JSON.stringify(rows.map((row) => React.isValidElement(row) ? row.key : ""))
  const pager = usePagedRows(rows, rowKey)
  const paged = pagination && pager.total > pager.pageSize
  let offset = 0
  const content = paged ? parts.map((part) => {
    if (!React.isValidElement<React.ComponentProps<typeof TableBody>>(part) || part.type !== TableBody) return part
    const bodyRows = tableChildren(part.props.children)
    const start = (pager.currentPage - 1) * pager.pageSize
    const visibleRows = bodyRows.filter((_, index) => offset + index >= start && offset + index < start + pager.pageSize)
    offset += bodyRows.length
    return React.cloneElement(part, {}, visibleRows)
  }) : children
  return (
    <>
      <div
        ref={viewportRef}
        data-slot="table-container"
        role={viewportLabel ? "region" : undefined}
        aria-label={viewportLabel}
        tabIndex={viewportLabel ? 0 : undefined}
        className={cn(
          "relative min-w-0 w-full max-w-full overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          bounded && "max-h-[min(36rem,60dvh)] overflow-auto [scroll-padding-top:var(--table-head-height,2.5rem)]",
        )}
      >
        <table
          data-slot="table"
          className={cn(
            "w-full caption-bottom text-sm",
            bounded && "[&>thead]:sticky [&>thead]:top-0 [&>thead]:z-10 [&>thead]:bg-muted [&>thead]:shadow-[0_1px_0_var(--border)]",
            className,
          )}
          {...props}
        >
          {content}
        </table>
      </div>
      {paged && <TablePager {...pager} />}
    </>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-muted/50 [&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border/70 transition-colors hover:bg-muted/35 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-[var(--table-head-height,2.5rem)] px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3 py-[var(--table-cell-y,0.625rem)] align-top whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
