"use client"

import Link from "next/link"
import { Fragment, type ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "../lib/utils"
import { Button } from "../components/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/breadcrumb"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/tabs"

export interface RecordPageCrumb {
  label: string
  /** Omit on the last crumb: it is the page itself. */
  href?: string
}

export interface RecordPageNavigation {
  /** 1-based place of this record in the list it was opened from. */
  position: number
  total: number
  previous?: { href: string; label: string }
  next?: { href: string; label: string }
}

export interface RecordPageTab {
  id: string
  label: string
  content: ReactNode
}

export interface RecordPageProps {
  breadcrumbs: ReadonlyArray<RecordPageCrumb>
  title: ReactNode
  subtitle?: ReactNode
  /** Next to the title, e.g. a state badge. */
  badge?: ReactNode
  /** Where the record is in its flow, e.g. a `StatusBar`. */
  statusBar?: ReactNode
  /** The record's actions, shown in the header. */
  actions?: ReactNode
  /** Related-record buttons, e.g. a `SmartButtons` row, shown under the title. */
  smartButtons?: ReactNode
  navigation?: RecordPageNavigation
  tabs: ReadonlyArray<RecordPageTab>
  activeTab: string
  onTabChange: (tabId: string) => void
  /** Prefix for test ids, e.g. `sale-order` gives `sale-order-page`, `sale-order-tab-lines`. */
  testIdPrefix: string
  className?: string
}

/**
 * Full-page view of one record: where it sits (breadcrumbs, previous/next), what it is (title,
 * state), what can be done with it (actions), and its content in tabs. The page owns no data;
 * callers pass in rendered pieces.
 */
export function RecordPage({
  breadcrumbs,
  title,
  subtitle,
  badge,
  statusBar,
  actions,
  smartButtons,
  navigation,
  tabs,
  activeTab,
  onTabChange,
  testIdPrefix,
  className,
}: RecordPageProps) {
  return (
    <div className={cn("space-y-6", className)} data-testid={`${testIdPrefix}-page`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
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
                      <BreadcrumbLink render={<Link href={crumb.href} />}>{crumb.label}</BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {isLast ? null : <BreadcrumbSeparator />}
                </Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>

        {navigation && navigation.total > 1 ? (
          <div className="flex items-center gap-1" data-testid={`${testIdPrefix}-navigation`}>
            <span className="mr-1 text-sm text-muted-foreground">
              {navigation.position} / {navigation.total}
            </span>
            <NavButton direction="previous" target={navigation.previous} testIdPrefix={testIdPrefix} />
            <NavButton direction="next" target={navigation.next} testIdPrefix={testIdPrefix} />
          </div>
        ) : null}
      </div>

      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight" data-testid={`${testIdPrefix}-title`}>
                {title}
              </h1>
              {badge}
            </div>
            {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2" data-testid={`${testIdPrefix}-actions`}>
              {actions}
            </div>
          ) : null}
        </div>
        {smartButtons}
        {statusBar}
      </header>

      <Tabs value={activeTab} onValueChange={(tabId) => onTabChange(String(tabId))} className="flex flex-col">
        <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
          <TabsList
            variant="line"
            className="h-auto w-max min-w-full justify-start gap-1 border-b border-border p-0 group-data-horizontal/tabs:h-auto"
          >
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                data-testid={`${testIdPrefix}-tab-${tab.id}`}
                className="-mb-px flex-none rounded-none border-0 border-b-2 border-transparent px-2.5 pb-2.5 pt-1.5 after:hidden data-active:border-foreground data-active:text-foreground"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="mt-6">
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

function NavButton({
  direction,
  target,
  testIdPrefix,
}: {
  direction: "previous" | "next"
  target: { href: string; label: string } | undefined
  testIdPrefix: string
}) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight
  const label = direction === "previous" ? "Previous record" : "Next record"
  if (!target) {
    return (
      <Button variant="outline" size="icon" disabled aria-label={label} data-testid={`${testIdPrefix}-${direction}`}>
        <Icon className="h-4 w-4" />
      </Button>
    )
  }
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={`${label}: ${target.label}`}
      title={target.label}
      data-testid={`${testIdPrefix}-${direction}`}
      nativeButton={false}
      render={<Link href={target.href} />}
    >
      <Icon className="h-4 w-4" />
    </Button>
  )
}
