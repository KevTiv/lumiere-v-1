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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../components/hover-card"
import { NavigationPagePreview } from "./navigation-page-preview"
import { DashboardWorkspaceContext } from "./dashboard-workspace"
import { readPreference, writePreference } from "../lib/theme-storage"

interface DashboardSidebarProps {
  forceCollapsed?: boolean
  onOpenJournal?: () => void
  onOpenNotebook?: () => void
  onOpenAIChat?: () => void
  aiChatOpen?: boolean
  /** Apply the fail-closed first-test-organization product admission profile. */
  firstOrgProfile?: boolean
  /** Optional nav badge counts keyed by href (e.g. pending AI approvals). */
  navBadges?: Record<string, number>
}

export function DashboardSidebar(props: DashboardSidebarProps) {
  const inWorkspace = useContext(DashboardWorkspaceContext)
  return inWorkspace ? <DashboardSidebarContent {...props} /> : (
    <SidebarProvider resizable defaultOpen={!props.forceCollapsed} style={{ "--sidebar-width-icon": "3rem" } as React.CSSProperties}><DashboardSidebarContent {...props} /></SidebarProvider>
  )
}

function DashboardSidebarContent({
  forceCollapsed,
  onOpenJournal,
  onOpenNotebook,
  onOpenAIChat,
  aiChatOpen = false,
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
    <aside id="dashboard-navigation" data-testid="dashboard-sidebar" className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className={cn("flex h-14 shrink-0 items-center justify-between border-b border-border/70 px-3", isCollapsed && "justify-center px-0")}>
        {!isCollapsed && (
          <span className="truncate text-sm font-semibold tracking-[-0.01em] text-sidebar-foreground">{t("nav.erpSystem")}</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label={isMobile ? t("workspaceShell.closeNavigation", { defaultValue: "Close navigation" }) : isCollapsed ? t("workspaceShell.expandNavigation", { defaultValue: "Expand navigation" }) : t("workspaceShell.collapseNavigation", { defaultValue: "Collapse navigation" })}
          className="size-9 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {isCollapsed ? <Menu className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <div className={cn("px-2 py-2", isCollapsed && "px-1 py-1.5")}>
        <CompanySwitcher collapsed={isCollapsed} className={isCollapsed ? "mx-auto size-9 justify-center p-0" : undefined} />
      </div>

      <nav className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-2", isCollapsed && "gap-1 px-1")}>
        {navGroups.map((group, groupIndex) => {
          const groupKey = group.items[0]!.surfaceId
          const expanded = !group.label || isCollapsed || !collapsedGroups.includes(groupKey)
          const groupId = `sidebar-category-${groupIndex}`
          return (
          <div key={groupKey}>
            {!isCollapsed && group.label && (
              <button type="button" aria-expanded={expanded} aria-controls={groupId}
                onClick={() => toggleGroup(groupKey)}
                className="mb-1 flex min-h-8 w-full items-center justify-between rounded-lg px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="truncate">{group.label}</span>
                <ChevronDown aria-hidden="true" className={cn("size-3 shrink-0 transition-transform", !expanded && "-rotate-90")} />
              </button>
            )}
            <div id={groupId} hidden={!expanded} className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const active = isActive(item.href)
                const hasAccess = checkPermission(item.resource, "read").allowed

                const badgeCount = navBadges?.[item.href] ?? 0

                if (hasAccess) {
                  const link = (
                    <Link
                      key={item.href}
                      href={item.href}
                      data-testid={`sidebar-link-${item.href.replace(/^\//, "")}`}
                      aria-label={isCollapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpenMobile(false)}
                      onMouseEnter={() => router.prefetch(item.href)}
                      className={cn(
                        "relative flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isCollapsed && "h-9 justify-center px-0 py-0",
                        active
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
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
                  return isCollapsed ? (
                    <HoverCard key={item.href}>
                      <HoverCardTrigger render={link} delay={250} closeDelay={100} />
                      <HoverCardContent side="right" align="start" alignOffset={0} sideOffset={8}
                        positionerClassName="pointer-events-none"
                        className="w-80 overflow-hidden p-0" data-testid="sidebar-page-preview">
                        <div className="flex items-center gap-2 px-3 py-2.5">
                          <Icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">{item.label}</span>
                        </div>
                        <NavigationPagePreview item={item} />
                      </HoverCardContent>
                    </HoverCard>
                  ) : link
                }

                return (
                  <div
                    key={item.href}
                    data-testid={`sidebar-link-${item.href.replace(/^\//, "")}-locked`}
                    title={isCollapsed ? item.label : undefined}
                    className={cn(
                      "flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm",
                      "cursor-not-allowed text-muted-foreground opacity-40",
                      isCollapsed && "h-9 justify-center px-0 py-0"
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

      <div className={cn("flex flex-col gap-1 border-t border-border/70 px-2 py-2", isCollapsed && "px-1 py-1.5")}>
        {onOpenJournal && quickActionIsVisible("journal") && (
          <button
            type="button"
            onClick={() => runQuickAction(onOpenJournal)}
            title="Open Journal"
            aria-label="Open Journal"
            className={cn(
              "flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              isCollapsed && "h-9 justify-center px-0 py-0"
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
              "flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              isCollapsed && "h-9 justify-center px-0 py-0"
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
            aria-pressed={aiChatOpen}
            data-testid="sidebar-open-ai-chat"
            className={cn(
              "flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              aiChatOpen ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              isCollapsed && "h-9 justify-center px-0 py-0"
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
