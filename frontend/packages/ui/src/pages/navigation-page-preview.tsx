"use client"

import { useTranslation } from "@lumiere/i18n"
import { Card, CardContent, CardHeader, CardTitle } from "../components/card"
import { Skeleton } from "../components/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/table"
import type { NavLinkItem } from "../lib/navigation-catalog"

const boardPages = new Set(["tasks", "projects", "workflows"])
const dashboardPages = new Set(["overview", "accounting", "sales", "crm", "purchasing", "reports", "expenses", "subscriptions", "forensics", "trackers", "iot"])

function PreviewLines() {
  return <div className="flex flex-col gap-3">
    <Skeleton className="h-3 w-3/4 animate-none" />
    <Skeleton className="h-3 w-1/2 animate-none" />
  </div>
}

/** Presentation-only JSX: no route mounts, queries, actions, or tenant records. */
export function NavigationPagePreview({ item }: { item: NavLinkItem }) {
  const { t } = useTranslation()
  const Icon = item.icon
  const layout = item.surfaceId === "calendar" ? "calendar" : boardPages.has(item.surfaceId) ? "board" : dashboardPages.has(item.surfaceId) ? "dashboard" : "records"

  return (
    <div className="relative h-44 overflow-hidden border-t bg-background" data-testid="sidebar-page-thumbnail" data-preview-layout={layout}>
      <div aria-hidden="true" inert className="pointer-events-none w-[960px] origin-top-left scale-[0.333] select-none p-8">
        <div className="mb-6 flex items-center gap-3">
          <Icon className="size-7 text-muted-foreground" />
          <h2 className="text-2xl font-semibold">{item.label}</h2>
        </div>
        <div className="mb-6 flex gap-4 border-b pb-3">
          <span className="text-sm font-medium">{t("nav.overview")}</span>
          <Skeleton className="h-4 w-20 animate-none" />
          <Skeleton className="h-4 w-24 animate-none" />
        </div>
        {layout === "dashboard" ? <>
          <div className="mb-6 grid grid-cols-3 gap-4">
            {[0, 1, 2].map((index) => <Card key={index} size="sm"><CardContent><PreviewLines /></CardContent></Card>)}
          </div>
          <div className="grid grid-cols-[2fr_1fr] gap-4">
            <Card><CardHeader><CardTitle>{item.label}</CardTitle></CardHeader><CardContent>
              <div className="flex h-40 items-end gap-4 border-b">
                {[35, 55, 42, 75, 62, 90, 78, 100].map((height, index) => <div key={index} className="flex-1 rounded-t bg-primary/25" style={{ height: `${height}%` }} />)}
              </div>
            </CardContent></Card>
            <Card><CardHeader><CardTitle>{t("nav.overview")}</CardTitle></CardHeader><CardContent><PreviewLines /></CardContent></Card>
          </div>
        </> : layout === "board" ? (
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map((column) => <div key={column} className="flex flex-col gap-4 rounded-lg bg-muted/40 p-4">
              <Skeleton className="h-4 w-24 animate-none" />
              {[0, 1, 2].map((row) => <Card key={row} size="sm"><CardContent><PreviewLines /></CardContent></Card>)}
            </div>)}
          </div>
        ) : layout === "calendar" ? (
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
            {Array.from({ length: 28 }, (_, index) => <div key={index} className="flex h-24 flex-col gap-3 bg-card p-3">
              <span className="text-xs text-muted-foreground">{index + 1}</span>
              {index % 3 === 0 && <Skeleton className="h-5 w-full animate-none" />}
            </div>)}
          </div>
        ) : (
          <Table><TableHeader><TableRow><TableHead>{item.label}</TableHead><TableHead><Skeleton className="h-3 w-20 animate-none" /></TableHead><TableHead><Skeleton className="h-3 w-16 animate-none" /></TableHead></TableRow></TableHeader>
            <TableBody>{Array.from({ length: 7 }, (_, index) => <TableRow key={index}>
              <TableCell><Skeleton className="h-4 w-48 animate-none" /></TableCell>
              <TableCell><Skeleton className="h-4 w-32 animate-none" /></TableCell>
              <TableCell><Skeleton className="h-4 w-20 animate-none" /></TableCell>
            </TableRow>)}</TableBody>
          </Table>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-popover to-transparent" data-testid="sidebar-preview-fade" />
    </div>
  )
}
