"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  Settings,
  Activity,
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
} from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { useRBAC } from "@/lib/rbac-context"
import type { Resource } from "@/lib/rbac-types"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../components/command"

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

export interface ErpCommandPaletteProps {
  onOpenAIChat?: () => void
  onOpenNotebook?: () => void
  onOpenJournal?: () => void
}

export function ErpCommandPalette({
  onOpenAIChat,
  onOpenNotebook,
  onOpenJournal,
}: ErpCommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { checkPermission } = useRBAC()
  const { t } = useTranslation()

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

  const accessibleNavGroups = useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => checkPermission(item.resource, "read").allowed),
        }))
        .filter((group) => group.items.length > 0),
    [checkPermission, navGroups],
  )

  const runAction = useCallback((action: () => void) => {
    setOpen(false)
    action()
  }, [])

  const navigate = useCallback(
    (href: string) => {
      setOpen(false)
      router.push(href)
    },
    [router],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const hasQuickActions = onOpenAIChat || onOpenNotebook || onOpenJournal

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command Palette"
      description="Search modules and quick actions"
      data-testid="erp-command-palette"
    >
      <Command>
        <CommandInput placeholder="Search modules and actions..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {hasQuickActions ? (
            <>
              <CommandGroup heading="Quick Actions">
                {onOpenAIChat ? (
                  <CommandItem
                    value={`${t("nav.aiAssistant")} ai assistant`}
                    onSelect={() => runAction(onOpenAIChat)}
                  >
                    <Sparkles className="h-4 w-4" />
                    {t("nav.aiAssistant")}
                  </CommandItem>
                ) : null}
                {onOpenNotebook ? (
                  <CommandItem
                    value={`${t("nav.notebook")} notebook`}
                    onSelect={() => runAction(onOpenNotebook)}
                  >
                    <BookOpen className="h-4 w-4" />
                    {t("nav.notebook")}
                  </CommandItem>
                ) : null}
                {onOpenJournal ? (
                  <CommandItem
                    value={`${t("nav.journal")} journal`}
                    onSelect={() => runAction(onOpenJournal)}
                  >
                    <BookMarked className="h-4 w-4" />
                    {t("nav.journal")}
                  </CommandItem>
                ) : null}
              </CommandGroup>
              <CommandSeparator />
            </>
          ) : null}

          {accessibleNavGroups.map((group, groupIndex) => (
            <CommandGroup
              key={group.label ?? `nav-group-${groupIndex}`}
              heading={group.label ?? "Navigation"}
            >
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <CommandItem
                    key={item.href}
                    value={`${item.label} ${item.href}`}
                    onSelect={() => navigate(item.href)}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
