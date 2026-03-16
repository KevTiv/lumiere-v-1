"use client"

import { useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useRBAC } from "@/lib/rbac-context"
import { dashboardViewPermissions } from "@/lib/rbac-defaults"
import { Badge } from "@/components/ui/badge"
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
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import type { Resource } from "@/lib/rbac-types"

interface NavItem {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  resource: Resource
}

interface ModuleItem {
  id: string
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  resource: Resource
}

interface DashboardSidebarProps {
  activeView: string
  onViewChange: (view: string) => void
  forceCollapsed?: boolean
  onOpenJournal?: () => void
  onOpenNotebook?: () => void
  onOpenAIChat?: () => void
}

const navItems: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, resource: "dashboard:overview" },
  { id: "tasks", label: "Tasks", icon: KanbanSquare, resource: "dashboard:tasks" },
  { id: "forensics", label: "Forensics", icon: FileSearch, resource: "dashboard:analytics" },
  { id: "analytics", label: "Trackers", icon: Activity, resource: "dashboard:analytics" },
  { id: "settings", label: "Settings", icon: Settings, resource: "dashboard:settings" },
]

const moduleItems: ModuleItem[] = [
  { id: "accounting", label: "Accounting", href: "/accounting", icon: BookOpen, resource: "module:accounting" },
  { id: "sales", label: "Sales", href: "/sales", icon: TrendingUp, resource: "module:sales" },
  { id: "crm", label: "CRM", href: "/crm", icon: Users, resource: "module:crm" },
  { id: "inventory", label: "Inventory", href: "/inventory", icon: Package, resource: "module:inventory" },
  { id: "purchasing", label: "Purchasing", href: "/purchasing", icon: ShoppingCart, resource: "module:purchasing" },
  { id: "hr", label: "HR & People", href: "/hr", icon: UserCheck, resource: "module:hr" },
  { id: "manufacturing", label: "Manufacturing", href: "/manufacturing", icon: Factory, resource: "module:manufacturing" },
  { id: "projects", label: "Projects", href: "/projects", icon: FolderKanban, resource: "module:projects" },
  { id: "iot", label: "IoT", href: "/iot", icon: Cpu, resource: "module:iot" },
]

export function DashboardSidebar({ activeView, onViewChange, forceCollapsed, onOpenJournal, onOpenNotebook, onOpenAIChat }: DashboardSidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [modulesExpanded, setModulesExpanded] = useState(true)
  const { checkPermission, currentUser, roles } = useRBAC()
  const isCollapsed = forceCollapsed || collapsed

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

      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activeView === item.id
          const hasAccess = checkPermission(item.resource, "read").allowed

          return (
            <button
              key={item.id}
              onClick={() => hasAccess && onViewChange(item.id)}
              disabled={!hasAccess}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent",
                !hasAccess && "opacity-40 cursor-not-allowed hover:bg-transparent"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!isCollapsed && (
                <span className="text-sm font-medium flex-1">{item.label}</span>
              )}
              {!isCollapsed && !hasAccess && (
                <Lock className="h-3 w-3 text-muted-foreground" />
              )}
            </button>
          )
        })}

        {/* Modules section */}
        <div className="pt-2">
          {!isCollapsed && (
            <button
              onClick={() => setModulesExpanded((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-sidebar-foreground transition-colors"
            >
              {modulesExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Modules
            </button>
          )}

          {(modulesExpanded || isCollapsed) && moduleItems.map((item) => {
            const Icon = item.icon
            const hasModuleAccess = checkPermission(item.resource, "read").allowed
            if (hasModuleAccess) {
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  title={isCollapsed ? item.label : undefined}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
                    "text-sidebar-foreground hover:bg-sidebar-accent"
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
                key={item.id}
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
      </nav>

      {/* Tool buttons - Journal, Notebook, AI Chat */}
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
