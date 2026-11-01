"use client"

import { useContext, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useRBAC } from "@/lib/rbac-context"
import { useTranslation } from "@lumiere/i18n"
import { CompanySwitcher } from "../settings/company-switcher"
import {
  ChevronDown,
  ChevronLeft,
  Menu,
  Lock,
  BookOpen,
  Sparkles,
  BookMarked,
} from "lucide-react"
import { buildNavGroups, type NavGroup } from "../lib/navigation-catalog"
import { useWorkspaceProfile } from "../lib/workspace-profile-context"
import { isWorkspaceSurfaceVisible } from "../lib/workspace-profile"
import { isFirstOrgSurfaceAdmitted } from "../lib/product-surface-catalog"
import { Sidebar, SidebarProvider, SidebarResizeHandle, useSidebar } from "../components/sidebar"
import { DashboardWorkspaceContext } from "./dashboard-workspace"
import { readPreference, writePreference } from "../lib/theme-storage"

interface DashboardSidebarProps {
  forceCollapsed?: boolean
  onOpenJournal?: () => void
  onOpenNotebook?: () => void
  onOpenAIChat?: () => void
  /** Apply the fail-closed first-test-organization product admission profile. */
  firstOrgProfile?: boolean
  /** Optional nav badge counts keyed by href (e.g. pending AI approvals). */
  navBadges?: Record<string, number>
}

export function DashboardSidebar(props: DashboardSidebarProps) {
  const inWorkspace = useContext(DashboardWorkspaceContext)
  return inWorkspace ? <DashboardSidebarContent {...props} /> : (
    <SidebarProvider resizable style={{ "--sidebar-width-icon": "4rem" } as React.CSSProperties}><DashboardSidebarContent {...props} /></SidebarProvider>
  )
}

function DashboardSidebarContent({
  forceCollapsed,
  onOpenJournal,
  onOpenNotebook,
  onOpenAIChat,
  firstOrgProfile = false,
  navBadges,
}: DashboardSidebarProps) {
  const { state, isMobile, toggleSidebar, setOpenMobile } = useSidebar()
  const { checkPermission, isAdmin } = useRBAC()
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useTranslation()
  const isCollapsed = !isMobile && (forceCollapsed || state === "collapsed")
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(readPreference("lumiere-sidebar-categories") ?? "[]")
      if (Array.isArray(saved) && saved.every((value) => typeof value === "string")) setCollapsedGroups(saved)
    } catch { /* Ignore invalid stored preferences. */ }
  }, [])
  const toggleGroup = (key: string) => {
    setCollapsedGroups((current) => {
      const next = current.includes(key) ? current.filter((value) => value !== key) : [...current, key]
      writePreference("lumiere-sidebar-categories", JSON.stringify(next))
      return next
    })
  }

  const workspaceProfile = useWorkspaceProfile()
  useEffect(() => { setOpenMobile(false) }, [pathname, setOpenMobile])

  const runQuickAction = (action: () => void) => {
    setOpenMobile(false)
    action()
  }

  const userIsAdmin = isAdmin()
  const navGroups = useMemo(
    (): NavGroup[] => buildNavGroups(t, { workspaceProfile, firstOrgProfile, isAdmin: userIsAdmin }),
    [workspaceProfile, firstOrgProfile, t, userIsAdmin],
  )
  const quickActionIsVisible = (surfaceId: string) =>
    isWorkspaceSurfaceVisible(workspaceProfile, surfaceId) &&
      (!firstOrgProfile || isFirstOrgSurfaceAdmitted(surfaceId, userIsAdmin))

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/")

  return (
    <Sidebar collapsible="icon" variant="sidebar">
    <aside id="dashboard-navigation" data-testid="dashboard-sidebar" className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
        {!isCollapsed && (
          <span className="truncate text-sm font-semibold tracking-[-0.01em] text-sidebar-foreground">{t("nav.erpSystem")}</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label={isMobile ? t("workspaceShell.closeNavigation", { defaultValue: "Close navigation" }) : isCollapsed ? t("workspaceShell.expandNavigation", { defaultValue: "Expand navigation" }) : t("workspaceShell.collapseNavigation", { defaultValue: "Collapse navigation" })}
          className="text-sidebar-foreground hover:bg-sidebar-accent"
        >
          {isCollapsed ? <Menu className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <div className="border-b border-sidebar-border px-2 py-2">
        <CompanySwitcher collapsed={isCollapsed} />
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-3">
        {navGroups.map((group, groupIndex) => {
          const groupKey = group.items[0]!.surfaceId
          const expanded = !group.label || isCollapsed || !collapsedGroups.includes(groupKey)
          const groupId = `sidebar-category-${groupIndex}`
          return (
          <div key={groupKey}>
            {!isCollapsed && group.label && (
              <button type="button" aria-expanded={expanded} aria-controls={groupId}
                onClick={() => toggleGroup(groupKey)}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-1 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                <span className="truncate">{group.label}</span>
                <ChevronDown aria-hidden="true" className={cn("size-3 shrink-0 transition-transform", !expanded && "-rotate-90")} />
              </button>
            )}
            <div id={groupId} hidden={!expanded} className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const active = isActive(item.href)
                const hasAccess = checkPermission(item.resource, "read").allowed

                const badgeCount = navBadges?.[item.href] ?? 0

                if (hasAccess) {
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      data-testid={`sidebar-link-${item.href.replace(/^\//, "")}`}
                      title={isCollapsed ? item.label : undefined}
                      aria-label={isCollapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpenMobile(false)}
                      onMouseEnter={() => router.prefetch(item.href)}
                      className={cn(
                        "relative w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!isCollapsed && (
                        <span className="truncate font-medium flex-1">{item.label}</span>
                      )}
                      {badgeCount > 0 ? (
                        <span
                          className={cn(
                            "inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground",
                            isCollapsed ? "absolute -top-1 -right-1 h-4 min-w-4 px-1" : "ml-auto",
                          )}
                        >
                          {badgeCount > 99 ? "99+" : badgeCount}
                        </span>
                      ) : null}
                    </Link>
                  )
                }

                return (
                  <div
                    key={item.href}
                    data-testid={`sidebar-link-${item.href.replace(/^\//, "")}-locked`}
                    title={isCollapsed ? item.label : undefined}
                    className={cn(
                      "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm",
                      "text-sidebar-foreground opacity-40 cursor-not-allowed"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!isCollapsed && (
                      <>
                        <span className="text-sm font-medium truncate flex-1">{item.label}</span>
                        <Lock className="h-3 w-3 text-muted-foreground" />
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )})}
      </nav>

      <div className="flex flex-col gap-1.5 border-t border-sidebar-border px-2 py-2">
        {onOpenJournal && quickActionIsVisible("journal") && (
          <button
            type="button"
            onClick={() => runQuickAction(onOpenJournal)}
            title="Open Journal"
            aria-label="Open Journal"
            className={cn(
              "flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-sm transition-colors",
              "text-sidebar-foreground/80 hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-foreground",
              isCollapsed && "justify-center"
            )}
          >
            <BookMarked className="h-4 w-4 shrink-0" />
            {!isCollapsed && (
              <span className="text-sm font-medium">{t("nav.journal")}</span>
            )}
          </button>
        )}

        {onOpenNotebook && quickActionIsVisible("notebook") && (
          <button
            type="button"
            onClick={() => runQuickAction(onOpenNotebook)}
            title="Open Notebook"
            aria-label="Open Notebook"
            className={cn(
              "flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-sm transition-colors",
              "text-sidebar-foreground/80 hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-foreground",
              isCollapsed && "justify-center"
            )}
          >
            <BookOpen className="h-4 w-4 shrink-0" />
            {!isCollapsed && (
              <span className="text-sm font-medium">{t("nav.notebook")}</span>
            )}
          </button>
        )}

        {onOpenAIChat && quickActionIsVisible("ai-assistant") && (
          <button
            type="button"
            onClick={() => runQuickAction(onOpenAIChat)}
            title="Open AI Assistant"
            aria-label="Open AI Assistant"
            data-testid="sidebar-open-ai-chat"
            className={cn(
              "flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-sm transition-colors",
              "text-sidebar-foreground/80 hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-foreground",
              isCollapsed && "justify-center"
            )}
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            {!isCollapsed && (
              <span className="text-sm font-medium">{t("nav.aiAssistant")}</span>
            )}
          </button>
        )}
      </div>

      {!forceCollapsed && <SidebarResizeHandle aria-label={t("workspaceShell.resizeNavigation", { defaultValue: "Resize navigation" })} />}
    </aside>
    </Sidebar>
  )
}
