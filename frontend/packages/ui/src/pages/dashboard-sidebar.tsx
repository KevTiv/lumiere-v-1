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
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  Settings,
  ChevronLeft,
  Menu,
  Activity,
  Lock,
  BookOpen,
  Sparkles,
  BookMarked,
  KanbanSquare,
  FileSearch,
  TrendingUp,
  UserCheck,
  Factory,
  FolderKanban,
  Cpu,
  FileText,
  Calendar,
  BarChart2,
  RefreshCw,
  Receipt,
  HelpCircle,
  GitBranch,
  MessageSquare,
  ClipboardList,
  ClipboardCheck,
  Map as MapIcon,
  LogOut,
} from "lucide-react"
import type { Resource } from "@/lib/rbac-types"

interface NavLinkItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  resource: Resource
}

interface NavGroup {
  label: string | null
  items: NavLinkItem[]
}

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

  const navGroups = useMemo((): NavGroup[] => [
    {
      label: null,
      items: [
        { label: t("nav.overview"), href: "/overview", icon: LayoutDashboard, resource: "dashboard:overview" },
        { label: t("nav.tasks"), href: "/tasks", icon: KanbanSquare, resource: "dashboard:tasks" },
      ],
    },
    {
      label: t("nav.groups.analytics"),
      items: [
        { label: t("nav.forensics"), href: "/forensics", icon: FileSearch, resource: "dashboard:analytics" },
        { label: t("nav.trackers"), href: "/trackers", icon: Activity, resource: "dashboard:analytics" },
        { label: "AI Skills", href: "/ai-skills", icon: Sparkles, resource: "dashboard:analytics" },
        { label: "Approvals", href: "/approvals", icon: ClipboardCheck, resource: "module:workflows" },
        { label: "AI Approvals", href: "/ai-action-drafts", icon: Sparkles, resource: "dashboard:analytics" },
      ],
    },
    {
      label: t("nav.groups.finance"),
      items: [
        { label: t("nav.accounting"), href: "/accounting", icon: BookOpen, resource: "module:accounting" },
        { label: t("nav.sales"), href: "/sales", icon: TrendingUp, resource: "module:sales" },
        { label: t("nav.crm"), href: "/crm", icon: Users, resource: "module:crm" },
        { label: t("nav.purchasing"), href: "/purchasing", icon: ShoppingCart, resource: "module:purchasing" },
        { label: t("nav.reports"), href: "/reports", icon: BarChart2, resource: "module:reports" },
        { label: t("nav.subscriptions"), href: "/subscriptions", icon: RefreshCw, resource: "module:subscriptions" },
        { label: t("nav.expenses"), href: "/expenses", icon: Receipt, resource: "module:expenses" },
      ],
    },
    {
      label: t("nav.groups.operations"),
      items: [
        { label: t("nav.inventory"), href: "/inventory", icon: Package, resource: "module:inventory" },
        { label: t("nav.pos"), href: "/pos", icon: ShoppingCart, resource: "module:pos" },
        { label: t("nav.manufacturing"), href: "/manufacturing", icon: Factory, resource: "module:manufacturing" },
        { label: t("nav.map"), href: "/map", icon: MapIcon, resource: "module:map" },
        { label: t("nav.helpdesk"), href: "/helpdesk", icon: HelpCircle, resource: "module:helpdesk" },
        { label: t("nav.workflows"), href: "/workflows", icon: GitBranch, resource: "module:workflows" },
      ],
    },
    {
      label: t("nav.groups.productivity"),
      items: [
        { label: t("nav.documents"), href: "/documents", icon: FileText, resource: "module:documents" },
        { label: t("nav.proposals"), href: "/proposals", icon: ClipboardList, resource: "module:proposals" },
        { label: t("nav.calendar"), href: "/calendar", icon: Calendar, resource: "module:calendar" },
        { label: t("nav.messages"), href: "/messages", icon: MessageSquare, resource: "module:messages" },
      ],
    },
    {
      label: t("nav.groups.people"),
      items: [
        { label: t("nav.hr"), href: "/hr", icon: UserCheck, resource: "module:hr" },
        { label: t("nav.projects"), href: "/projects", icon: FolderKanban, resource: "module:projects" },
      ],
    },
    {
      label: t("nav.groups.system"),
      items: [
        { label: t("nav.iot"), href: "/iot", icon: Cpu, resource: "module:iot" },
        { label: t("nav.settings"), href: "/settings", icon: Settings, resource: "dashboard:settings" },
      ],
    },
  ], [t])

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
