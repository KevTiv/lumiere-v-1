/**
 * Shared navigation catalog for sidebar and command palette.
 *
 * Contains the single source of truth for navigation groups, labels,
 * paths, icons, and permission resources. Both presentations (sidebar
 * and command palette) consume this catalog; their state, actions,
 * badges, shortcuts, and rendering remain separate.
 */
import {
  Activity,
  BarChart2,
  BookOpen,
  Calendar,
  ClipboardCheck,
  ClipboardList,
  Cpu,
  Factory,
  FileSearch,
  FileText,
  FolderKanban,
  GitBranch,
  HelpCircle,
  KanbanSquare,
  LayoutDashboard,
  Map as MapIcon,
  MessageSquare,
  Package,
  Receipt,
  RefreshCw,
  Settings,
  ShoppingCart,
  Sparkles,
  Store,
  TrendingUp,
  Truck,
  UserCheck,
  Users,
} from "lucide-react"

import type { Resource } from "./rbac-types"
import { isFirstOrgSurfaceAdmitted } from "./product-surface-catalog"

export interface NavLinkItem {
  surfaceId: string
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  resource: Resource
}

export interface NavGroup {
  label: string | null
  items: NavLinkItem[]
}

export interface NavigationCatalogOptions {
  firstOrgProfile?: boolean
  isAdmin?: boolean
}

/**
 * Build the navigation groups using the provided translation function.
 * Both sidebar and command palette call this with their `t` from `useTranslation`.
 */
export function buildNavGroups(
  t: (key: string) => string,
  options: NavigationCatalogOptions = {},
): NavGroup[] {
  const groups: NavGroup[] = [
    {
      label: null,
      items: [
        { surfaceId: "overview", label: t("nav.overview"), href: "/overview", icon: LayoutDashboard, resource: "dashboard:overview" },
        { surfaceId: "tasks", label: t("nav.tasks"), href: "/tasks", icon: KanbanSquare, resource: "dashboard:tasks" },
      ],
    },
    {
      label: t("nav.groups.analytics"),
      items: [
        { surfaceId: "forensics", label: t("nav.forensics"), href: "/forensics", icon: FileSearch, resource: "dashboard:analytics" },
        { surfaceId: "trackers", label: t("nav.trackers"), href: "/trackers", icon: Activity, resource: "dashboard:analytics" },
        { surfaceId: "ai-skills", label: "AI Skills", href: "/ai-skills", icon: Sparkles, resource: "dashboard:analytics" },
        { surfaceId: "approvals", label: "Approvals", href: "/approvals", icon: ClipboardCheck, resource: "module:workflows" },
        { surfaceId: "ai-action-drafts", label: "AI Approvals", href: "/ai-action-drafts", icon: Sparkles, resource: "dashboard:analytics" },
      ],
    },
    {
      label: t("nav.groups.finance"),
      items: [
        { surfaceId: "accounting", label: t("nav.accounting"), href: "/accounting", icon: BookOpen, resource: "module:accounting" },
        { surfaceId: "sales", label: t("nav.sales"), href: "/sales", icon: TrendingUp, resource: "module:sales" },
        { surfaceId: "crm", label: t("nav.crm"), href: "/crm", icon: Users, resource: "module:crm" },
        { surfaceId: "purchasing", label: t("nav.purchasing"), href: "/purchasing", icon: ShoppingCart, resource: "module:purchasing" },
        { surfaceId: "reports", label: t("nav.reports"), href: "/reports", icon: BarChart2, resource: "module:reports" },
        { surfaceId: "subscriptions", label: t("nav.subscriptions"), href: "/subscriptions", icon: RefreshCw, resource: "module:subscriptions" },
        { surfaceId: "expenses", label: t("nav.expenses"), href: "/expenses", icon: Receipt, resource: "module:expenses" },
      ],
    },
    {
      label: t("nav.groups.operations"),
      items: [
        { surfaceId: "inventory", label: t("nav.inventory"), href: "/inventory", icon: Package, resource: "module:inventory" },
        { surfaceId: "distributor", label: t("nav.distributor"), href: "/distributor", icon: Store, resource: "module:inventory" },
        { surfaceId: "pos", label: t("nav.pos"), href: "/pos", icon: ShoppingCart, resource: "module:pos" },
        { surfaceId: "manufacturing", label: t("nav.manufacturing"), href: "/manufacturing", icon: Factory, resource: "module:manufacturing" },
        { surfaceId: "map", label: t("nav.map"), href: "/map", icon: MapIcon, resource: "module:map" },
        { surfaceId: "fleet", label: t("nav.fleet"), href: "/fleet", icon: Truck, resource: "module:fleet" },
        { surfaceId: "helpdesk", label: t("nav.helpdesk"), href: "/helpdesk", icon: HelpCircle, resource: "module:helpdesk" },
        { surfaceId: "workflows", label: t("nav.workflows"), href: "/workflows", icon: GitBranch, resource: "module:workflows" },
      ],
    },
    {
      label: t("nav.groups.productivity"),
      items: [
        { surfaceId: "documents", label: t("nav.documents"), href: "/documents", icon: FileText, resource: "module:documents" },
        { surfaceId: "proposals", label: t("nav.proposals"), href: "/proposals", icon: ClipboardList, resource: "module:proposals" },
        { surfaceId: "calendar", label: t("nav.calendar"), href: "/calendar", icon: Calendar, resource: "module:calendar" },
        { surfaceId: "messages", label: t("nav.messages"), href: "/messages", icon: MessageSquare, resource: "module:messages" },
      ],
    },
    {
      label: t("nav.groups.people"),
      items: [
        { surfaceId: "hr", label: t("nav.hr"), href: "/hr", icon: UserCheck, resource: "module:hr" },
        { surfaceId: "projects", label: t("nav.projects"), href: "/projects", icon: FolderKanban, resource: "module:projects" },
      ],
    },
    {
      label: t("nav.groups.system"),
      items: [
        { surfaceId: "iot", label: t("nav.iot"), href: "/iot", icon: Cpu, resource: "module:iot" },
        { surfaceId: "settings", label: t("nav.settings"), href: "/settings", icon: Settings, resource: "dashboard:settings" },
      ],
    },
  ]

  if (!options.firstOrgProfile) return groups

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        isFirstOrgSurfaceAdmitted(item.surfaceId, options.isAdmin ?? false),
      ),
    }))
    .filter((group) => group.items.length > 0)
}
