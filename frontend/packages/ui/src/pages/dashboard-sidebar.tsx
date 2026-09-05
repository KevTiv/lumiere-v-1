"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useRBAC } from "@/lib/rbac-context"
import { useTranslation } from "@lumiere/i18n"
import { CompanySwitcher } from "../settings/company-switcher"
import {
  ChevronLeft,
  Menu,
  Lock,
  BookOpen,
  Sparkles,
  BookMarked,
  LogOut,
} from "lucide-react"
import { buildNavGroups, type NavGroup } from "../lib/navigation-catalog"

interface DashboardSidebarProps {
  forceCollapsed?: boolean
  onOpenJournal?: () => void
  onOpenNotebook?: () => void
  onOpenAIChat?: () => void
  /** Optional nav badge counts keyed by href (e.g. pending AI approvals). */
  navBadges?: Record<string, number>
  /** When set, shows a sidebar control that calls this handler (typically clears session + redirects). */
  onSignOut?: () => void | Promise<void>
}

export function DashboardSidebar({
  forceCollapsed,
  onOpenJournal,
  onOpenNotebook,
  onOpenAIChat,
  navBadges,
  onSignOut,
}: DashboardSidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { checkPermission, currentUser, roles } = useRBAC()
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useTranslation()
  const isCollapsed = forceCollapsed || collapsed

  const navGroups = useMemo((): NavGroup[] => buildNavGroups(t), [t])

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/")

  const getUserRoleName = () => {
    if (!currentUser || currentUser.roles.length === 0) return t("nav.noRole")
    const role = roles.find(r => r.id === currentUser.roles[0])
    return role?.name || currentUser.roles[0]
  }

  return (
    <aside
      data-testid="dashboard-sidebar"
      className={cn(
        "h-screen bg-sidebar border-r border-sidebar-border flex flex-col transition-[width] duration-200",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-3">
        {!isCollapsed && (
          <span className="truncate text-sm font-semibold tracking-[-0.01em] text-sidebar-foreground">{t("nav.erpSystem")}</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
          className="text-sidebar-foreground hover:bg-sidebar-accent"
        >
          {isCollapsed ? <Menu className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <div className="border-b border-sidebar-border px-2 py-2">
        <CompanySwitcher collapsed={isCollapsed} />
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-3">
        {navGroups.map((group, groupIndex) => (
          <div key={`sidebar-option-${String(groupIndex)}`}>
            {!isCollapsed && group.label && (
              <p className="px-2.5 py-1 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
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
                      onMouseEnter={() => router.prefetch(item.href)}
                      className={cn(
                        "relative w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/20",
                        active
                          ? "bg-sidebar-accent text-sidebar-foreground shadow-xs ring-1 ring-sidebar-border"
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
        ))}
      </nav>

      <div className="flex flex-col gap-1.5 border-t border-sidebar-border px-2 py-2">
        {onOpenJournal && (
          <button
            type="button"
            onClick={onOpenJournal}
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

        {onOpenNotebook && (
          <button
            type="button"
            onClick={onOpenNotebook}
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

        {onOpenAIChat && (
          <button
            type="button"
            onClick={onOpenAIChat}
            title="Open AI Assistant"
            aria-label="Open AI Assistant"
            data-testid="sidebar-open-ai-chat"
            className={cn(
              "flex items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent px-2.5 py-2 text-sm transition-colors",
              "text-sidebar-foreground hover:bg-sidebar-accent/70",
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

      <div className="space-y-3 border-t border-sidebar-border p-3">
        <div className={cn("flex items-center gap-3", isCollapsed && "justify-center")} data-testid="sidebar-user">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent text-sm font-medium text-sidebar-foreground">
            {currentUser?.name.split(" ").map(n => n[0]).join("") || "?"}
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">
                {currentUser?.name || "Guest"}
              </p>
              <p className="text-xs text-muted-foreground truncate">{getUserRoleName()}</p>
            </div>
          )}
        </div>
        {onSignOut ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "w-full border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent",
              !isCollapsed && "justify-start gap-2",
              isCollapsed && "px-0 justify-center",
            )}
            title={isCollapsed ? t("nav.signOut") : undefined}
            onClick={() => {
              void onSignOut()
            }}
            data-testid="sidebar-sign-out"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!isCollapsed ? <span className="truncate">{t("nav.signOut")}</span> : null}
          </Button>
        ) : null}
      </div>
    </aside>
  )
}
