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
  UserCheck,
  Users,
} from "lucide-react"

import type { Resource } from "./rbac-types"

export interface NavLinkItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  resource: Resource
}

export interface NavGroup {
  label: string | null
  items: NavLinkItem[]
}

/**
 * Build the navigation groups using the provided translation function.
 * Both sidebar and command palette call this with their `t` from `useTranslation`.
 */
export function buildNavGroups(t: (key: string) => string): NavGroup[] {
  return [
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
        { label: t("nav.distributor"), href: "/distributor", icon: Store, resource: "module:inventory" },
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
  ]
}
