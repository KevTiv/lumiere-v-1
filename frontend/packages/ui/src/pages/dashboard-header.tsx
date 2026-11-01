"use client"

import type { ReactNode } from "react"
import { Fragment, createContext, useContext } from "react"
import type { HistoryBounds, HistoryDates, HistoryPeriod } from "@lumiere/erp-shared/history-period"
import Link from "next/link"
import { Button } from "../components/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/breadcrumb"
import { HistoryPeriodSelect } from "../components/history-period-select"
import { RefreshCw, Download } from "lucide-react"
import { workspaceStyles } from "../lib/workspace-styles"

interface ActionItem {
  label: string
  onClick: () => void
  variant?: "default" | "outline" | "destructive" | "secondary" | "ghost" | "link"
  testId?: string
}

export type TimeRangeValue = HistoryPeriod

interface BreadcrumbItemConfig {
  label: string
  href?: string
}

interface DashboardHeaderProps {
  title: string
  description?: string
  breadcrumbs?: BreadcrumbItemConfig[]
  primaryAction?: ReactNode
  onRefresh?: () => void
  onExport?: () => void
  actions?: ActionItem[]
  timeRange?: TimeRangeValue
  onTimeRangeChange?: (value: TimeRangeValue) => void
  timeZone?: string
  historyCoverage?: HistoryBounds
  historyCoverageDates?: HistoryDates
}

/** Content the app shell shows at the end of every DashboardHeader's actions (e.g. the notifications bell). */
const HeaderTrailingContext = createContext<ReactNode>(null)
export const HeaderTrailingProvider = HeaderTrailingContext.Provider

export function DashboardHeader({
  title,
  description,
  breadcrumbs,
  primaryAction,
  onRefresh,
  onExport,
  actions,
  timeRange = "all",
  onTimeRangeChange,
  timeZone,
  historyCoverage,
  historyCoverageDates,
}: DashboardHeaderProps) {
  const trailing = useContext(HeaderTrailingContext)
  const hasPrimaryAction = primaryAction != null && primaryAction !== false
  const firstImplicitAction = hasPrimaryAction ? -1 : actions?.findIndex((action) => action.variant == null) ?? -1

  return (
    <header className={workspaceStyles.pageHeader} data-ui="page-header">
      <div className="min-w-0 space-y-1">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1
                return (
                  <Fragment key={`${crumb.label}-${index}`}>
                    <BreadcrumbItem>
                      {isLast || !crumb.href ? (
                        <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink render={<Link href={crumb.href} />}>
                          {crumb.label}
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                    {!isLast ? <BreadcrumbSeparator /> : null}
                  </Fragment>
                )
              })}
            </BreadcrumbList>
          </Breadcrumb>
        ) : null}
        <h1 className={workspaceStyles.pageTitle} data-ui="page-title">{title}</h1>
        {description && (
          <p className={workspaceStyles.pageDescription}>{description}</p>
        )}
      </div>
      <div className={workspaceStyles.actions}>
        {primaryAction}
        {actions?.map((action, index) => (
          <Button
            key={action.label}
            variant={action.variant ?? (index === firstImplicitAction ? "default" : "outline")}
            onClick={action.onClick}
            data-testid={action.testId}
          >
            {action.label}
          </Button>
        ))}
        {onTimeRangeChange ? (
          <HistoryPeriodSelect
            value={timeRange}
            onChange={onTimeRangeChange}
            timeZone={timeZone}
            coverage={historyCoverage}
            coverageDates={historyCoverageDates}
          />
        ) : null}
        {onRefresh ? (
          <Button variant="outline" size="icon" onClick={onRefresh} aria-label="Refresh dashboard">
            <RefreshCw className="h-4 w-4" />
          </Button>
        ) : null}
        {onExport ? (
          <Button variant="outline" size="icon" onClick={onExport} aria-label="Export dashboard">
            <Download className="h-4 w-4" />
          </Button>
        ) : null}
        {trailing}
      </div>
    </header>
  )
}
