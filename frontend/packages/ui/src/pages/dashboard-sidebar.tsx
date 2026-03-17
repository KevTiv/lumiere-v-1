"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useRBAC } from "@/lib/rbac-context"
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
}

const navGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { label: "Overview", href: "/overview", icon: LayoutDashboard, resource: "dashboard:overview" },
      { label: "Tasks", href: "/tasks", icon: KanbanSquare, resource: "dashboard:tasks" },
    ],
  },
  {
    label: "Analytics",
    items: [
      { label: "Forensics", href: "/forensics", icon: FileSearch, resource: "dashboard:analytics" },
      { label: "Trackers", href: "/trackers", icon: Activity, resource: "dashboard:analytics" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Accounting", href: "/accounting", icon: BookOpen, resource: "module:accounting" },
      { label: "Sales", href: "/sales", icon: TrendingUp, resource: "module:sales" },
      { label: "CRM", href: "/crm", icon: Users, resource: "module:crm" },
      { label: "Purchasing", href: "/purchasing", icon: ShoppingCart, resource: "module:purchasing" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Inventory", href: "/inventory", icon: Package, resource: "module:inventory" },
      { label: "Manufacturing", href: "/manufacturing", icon: Factory, resource: "module:manufacturing" },
    ],
  },
  {
    label: "People",
    items: [
      { label: "HR & People", href: "/hr", icon: UserCheck, resource: "module:hr" },
      { label: "Projects", href: "/projects", icon: FolderKanban, resource: "module:projects" },
    ],
  },
  {
    label: "System",
    items: [
      { label: "IoT", href: "/iot", icon: Cpu, resource: "module:iot" },
      { label: "Settings", href: "/settings", icon: Settings, resource: "dashboard:settings" },
    ],
  },
]

export function DashboardSidebar({ forceCollapsed, onOpenJournal, onOpenNotebook, onOpenAIChat }: DashboardSidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { checkPermission, currentUser, roles } = useRBAC()
  const pathname = usePathname()
  const isCollapsed = forceCollapsed || collapsed

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/")

  const getUserRoleName = () => {
    if (!currentUser || currentUser.roles.length === 0) return "No Role"
    const role = roles.find(r => r.id === currentUser.roles[0])
    return role?.name || currentUser.roles[0]
  }

  return (
    <aside
      className={cn(
        "h-screen bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      <div className="flex items-center justify-between h-16 px-4 border-b border-sidebar-border">
        {!isCollapsed && (
          <span className="font-bold text-lg text-sidebar-foreground">ERP System</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="text-sidebar-foreground hover:bg-sidebar-accent"
        >
          {isCollapsed ? <Menu className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </Button>
      </div>

      <nav className="flex-1 p-2 space-y-4 overflow-y-auto">
        {navGroups.map((group, groupIndex) => (
          <div key={`sidebar-option-${groupIndex}`}>
            {!isCollapsed && group.label && (
              <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const active = isActive(item.href)
                const hasAccess = checkPermission(item.resource, "read").allowed

                if (hasAccess) {
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={isCollapsed ? item.label : undefined}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
                        active
                          ? "bg-sidebar-primary text-sidebar-primary-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent"
                      )}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      {!isCollapsed && (
                        <span className="text-sm font-medium truncate">{item.label}</span>
                      )}
                    </Link>
                  )
                }

                return (
                  <div
                    key={item.href}
                    title={isCollapsed ? item.label : undefined}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg",
                      "text-sidebar-foreground opacity-40 cursor-not-allowed"
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
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

      {/* Tool buttons — Journal, Notebook, AI Chat */}
      <div className="flex flex-col gap-2 px-2 pb-2">
        {onOpenJournal && (
          <button
            onClick={onOpenJournal}
            title="Open Journal"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
              "bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20",
              "text-sidebar-foreground hover:border-amber-500/40",
              isCollapsed && "justify-center"
            )}
          >
            <BookMarked className="h-5 w-5 shrink-0 text-amber-500" />
            {!isCollapsed && (
              <span className="text-sm font-medium">Journal</span>
            )}
          </button>
        )}

        {onOpenNotebook && (
          <button
            onClick={onOpenNotebook}
            title="Open Notebook"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
              "bg-gradient-to-r from-orange-500/10 to-orange-600/10 border border-orange-500/20",
              "text-sidebar-foreground hover:border-orange-500/40",
              isCollapsed && "justify-center"
            )}
          >
            <BookOpen className="h-5 w-5 shrink-0 text-orange-500" />
            {!isCollapsed && (
              <span className="text-sm font-medium">Notebook</span>
            )}
          </button>
        )}

        {onOpenAIChat && (
          <button
            onClick={onOpenAIChat}
            title="Open AI Assistant"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
              "bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20",
              "text-sidebar-foreground hover:border-primary/40",
              isCollapsed && "justify-center"
            )}
          >
            <Sparkles className="h-5 w-5 shrink-0 text-primary" />
            {!isCollapsed && (
              <span className="text-sm font-medium">AI Assistant</span>
            )}
          </button>
        )}
      </div>

      <div className="p-4 border-t border-sidebar-border">
        <div className={cn("flex items-center gap-3", isCollapsed && "justify-center")}>
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-medium">
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
      </div>
    </aside>
  )
}
