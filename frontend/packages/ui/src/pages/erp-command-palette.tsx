"use client"

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  BookOpen,
  Sparkles,
  BookMarked,
  Clock,
  FilePlus2,
  Moon,
  Receipt,
  Rows3,
  ShoppingCart,
  Sun,
} from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import { useRBAC } from "@/lib/rbac-context"
import { buildNavGroups, type NavGroup } from "../lib/navigation-catalog"
import { isQuickCreateHref, QUICK_CREATE_TARGETS, quickCreateHref } from "../lib/quick-create"
import { isRecordSearchQuery } from "../lib/record-search"
import { buildCommandWorkspaceLinks } from "../lib/command-workspace-links"
import { RecordSearchResults, type RecordSearchSummary } from "./erp-command-palette-records"
import { useWorkspaceProfile } from "../lib/workspace-profile-context"
import { isWorkspaceSurfaceVisible } from "../lib/workspace-profile"
import { isFirstOrgSurfaceAdmitted } from "../lib/product-surface-catalog"
import { useOptionalTheme } from "../components/theme-provider"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "../components/command"

const RECENT_STORAGE_KEY = "lumiere-recent-commands"
const MAX_RECENT_ITEMS = 5

interface RecentCommandItem {
  label: string
  href: string
}

function readRecentCommands(): RecentCommandItem[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is RecentCommandItem =>
          item && typeof item.label === "string" && typeof item.href === "string" && item.href.startsWith("/") && !item.href.startsWith("//") && !isQuickCreateHref(item.href),
      )
      .slice(0, MAX_RECENT_ITEMS)
  } catch {
    return []
  }
}

function pushRecentCommand(item: RecentCommandItem): RecentCommandItem[] {
  const existing = readRecentCommands().filter((entry) => entry.href !== item.href)
  const next = [item, ...existing].slice(0, MAX_RECENT_ITEMS)
  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore storage failures
  }
  return next
}

export interface ErpCommandPaletteProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onOpenAIChat?: () => void
  onOpenNotebook?: () => void
  onOpenJournal?: () => void
  /** Apply the fail-closed first-test-organization product admission profile. */
  firstOrgProfile?: boolean
  farmOperationsEnabled?: boolean
  /** Record page of a model (e.g. `recordPageHref`); models with no page fall back to their module tab. */
  recordHref?: (model: string, id: string) => string | undefined
}

export function ErpCommandPalette({
  open: controlledOpen,
  onOpenChange,
  onOpenAIChat,
  onOpenNotebook,
  onOpenJournal,
  firstOrgProfile = false,
  farmOperationsEnabled = false,
  recordHref,
}: ErpCommandPaletteProps) {
  const [internalOpen, setOpenState] = useState(false)
  const open = controlledOpen ?? internalOpen
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [recentItems, setRecentItems] = useState<RecentCommandItem[]>([])
  const [recordSummary, setRecordSummary] = useState<RecordSearchSummary | null>(null)
  const { organizationId } = useErpSession()
  const themeCtx = useOptionalTheme()
  const setOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next
    setOpenState(value)
    onOpenChange?.(value)
    // The next opening starts from an empty query.
    setSearch("")
    setRecordSummary(null)
  }, [onOpenChange, open])
  const router = useRouter()
  const { checkPermission, isAdmin, permissionsReady } = useRBAC()
  const { t } = useTranslation()

  // Load recent items when palette opens.
  useEffect(() => {
    if (open) setRecentItems(readRecentCommands())
  }, [open])

  const workspaceProfile = useWorkspaceProfile()
  const userIsAdmin = isAdmin()
  const navGroups = useMemo(
    (): NavGroup[] => buildNavGroups(t, { workspaceProfile, firstOrgProfile, isAdmin: userIsAdmin, farmOperationsEnabled }),
    [workspaceProfile, firstOrgProfile, t, userIsAdmin, farmOperationsEnabled],
  )
  const quickActionIsVisible = useCallback(
    (surfaceId: string) =>
      isWorkspaceSurfaceVisible(workspaceProfile, surfaceId) &&
      (!firstOrgProfile || isFirstOrgSurfaceAdmitted(surfaceId, userIsAdmin)),
    [workspaceProfile, firstOrgProfile, userIsAdmin],
  )

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

  // Record reads start only while the palette is open and the query is long enough.
  const recordSearchActive =
    open && organizationId != null && organizationId > 0 && isRecordSearchQuery(deferredSearch)
  const allowedResourceKey = accessibleNavGroups
    .flatMap((group) => group.items.map((item) => item.resource))
    .sort()
    .join("\n")
  const allowedResources = useMemo(() => new Set(allowedResourceKey.split("\n")), [allowedResourceKey])
  const allowedSurfaceKey = accessibleNavGroups
    .flatMap((group) => group.items.map((item) => item.surfaceId))
    .sort()
    .join("\n")
  const allowedSurfaceIds = useMemo(() => new Set(allowedSurfaceKey.split("\n")), [allowedSurfaceKey])
  const workspaceLinks = useMemo(
    () => buildCommandWorkspaceLinks(accessibleNavGroups, t),
    [accessibleNavGroups, t],
  )
  useEffect(() => {
    if (!recordSearchActive) setRecordSummary(null)
  }, [recordSearchActive])
  const resolveRecordHref = useCallback(
    (model: string, id: string) => recordHref?.(model, id),
    [recordHref],
  )
  const showEmpty = !recordSearchActive || (recordSummary != null && !recordSummary.loading && !recordSummary.failed && recordSummary.count === 0)

  const runAction = useCallback((action: () => void) => {
    setOpen(false)
    action()
  }, [setOpen])

  const navigate = useCallback(
    (href: string, label?: string) => {
      if (label) {
        setRecentItems(pushRecentCommand({ label, href }))
      }
      setOpen(false)
      router.push(href)
    },
    [router, setOpen],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [setOpen])

  const visibleAiChat = quickActionIsVisible("ai-assistant") ? onOpenAIChat : undefined
  const visibleNotebook = quickActionIsVisible("notebook") ? onOpenNotebook : undefined
  const visibleJournal = quickActionIsVisible("journal") ? onOpenJournal : undefined
  const hasQuickActions = visibleAiChat || visibleNotebook || visibleJournal

  const quickCreates = useMemo(() => {
    if (permissionsReady === false || organizationId == null || organizationId <= 0) return []
    const actions = {
      invoice: { label: t("commandPalette.quickCreate.invoice", { defaultValue: "New customer invoice" }), keywords: "create invoice ar billing", icon: FilePlus2 },
      bill: { label: t("commandPalette.quickCreate.bill", { defaultValue: "New vendor bill" }), keywords: "create bill ap payable", icon: FilePlus2 },
      expense: { label: t("commandPalette.quickCreate.expense", { defaultValue: "New expense" }), keywords: "create expense receipt spend", icon: Receipt },
      salesOrder: { label: t("commandPalette.quickCreate.salesOrder", { defaultValue: "New sales order" }), keywords: "create quote order sales", icon: ShoppingCart },
    }
    return (Object.keys(actions) as Array<keyof typeof actions>).flatMap((action) => {
      const { module, resource } = QUICK_CREATE_TARGETS[action]
      return allowedSurfaceIds.has(module) &&
        checkPermission(resource, "read").allowed && checkPermission(resource, "create").allowed
        ? [{ ...actions[action], href: quickCreateHref(action) }]
        : []
    })
  }, [allowedSurfaceIds, checkPermission, organizationId, permissionsReady, t])

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command Palette"
      description="Search modules, quick actions and records"
      data-testid="erp-command-palette"
    >
      <Command>
        <CommandInput
          placeholder={t("commandPalette.placeholder", { defaultValue: "Search modules, actions and records..." })}
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          {showEmpty ? <CommandEmpty>No results found.</CommandEmpty> : null}

          {!search.trim() && recentItems.length > 0 ? (
            <>
              <CommandGroup heading={t("commandPalette.recent.heading", { defaultValue: "Recent" })}>
                {recentItems.map((item) => (
                  <CommandItem
                    key={item.href}
                    value={`recent ${item.label} ${item.href}`}
                    onSelect={() => navigate(item.href, item.label)}
                  >
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          ) : null}

          {recordSearchActive && organizationId != null ? (
            <RecordSearchResults
              organizationId={BigInt(organizationId)}
              query={deferredSearch}
              allowedResources={allowedResources}
              allowedSurfaceIds={allowedSurfaceIds}
              recordHref={resolveRecordHref}
              onNavigate={(href) => navigate(href)}
              onSummary={setRecordSummary}
            />
          ) : null}

          {isRecordSearchQuery(search) && workspaceLinks.length > 0 ? (
            <CommandGroup heading={t("commandPalette.workspaces.heading", { defaultValue: "Go to workspace" })}>
              {workspaceLinks.map((item) => {
                const Icon = item.icon
                return (
                  <CommandItem
                    key={item.href}
                    value={`${item.label} ${item.href} ${item.keywords}`}
                    onSelect={() => navigate(item.href, item.label)}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ) : null}

          {quickCreates.length > 0 ? (
            <>
              <CommandGroup heading={t("commandPalette.quickCreate.heading", { defaultValue: "Quick Create" })}>
                {quickCreates.map((item) => {
                  const Icon = item.icon
                  return (
                    <CommandItem
                      key={item.href}
                      value={`${item.label} ${item.keywords}`}
                      onSelect={() => navigate(item.href)}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
              <CommandSeparator />
            </>
          ) : null}

          {hasQuickActions ? (
            <>
              <CommandGroup heading="Quick Actions">
                {visibleAiChat ? (
                  <CommandItem
                    value={`${t("nav.aiAssistant")} ai assistant`}
                    onSelect={() => runAction(visibleAiChat)}
                  >
                    <Sparkles className="h-4 w-4" />
                    {t("nav.aiAssistant")}
                  </CommandItem>
                ) : null}
                {visibleNotebook ? (
                  <CommandItem
                    value={`${t("nav.notebook")} notebook`}
                    onSelect={() => runAction(visibleNotebook)}
                  >
                    <BookOpen className="h-4 w-4" />
                    {t("nav.notebook")}
                  </CommandItem>
                ) : null}
                {visibleJournal ? (
                  <CommandItem
                    value={`${t("nav.journal")} journal`}
                    onSelect={() => runAction(visibleJournal)}
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
                    onSelect={() => navigate(item.href, item.label)}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}

          {themeCtx ? (
            <>
              <CommandSeparator />
              <CommandGroup heading={t("commandPalette.preferences.heading", { defaultValue: "Preferences" })}>
                <CommandItem
                  value="toggle theme dark mode light mode appearance"
                  onSelect={() => runAction(() => themeCtx.setTheme(themeCtx.resolvedTheme === "dark" ? "light" : "dark"))}
                >
                  {themeCtx.resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  {themeCtx.resolvedTheme === "dark"
                    ? t("commandPalette.preferences.lightMode", { defaultValue: "Switch to light mode" })
                    : t("commandPalette.preferences.darkMode", { defaultValue: "Switch to dark mode" })}
                  <CommandShortcut>{themeCtx.resolvedTheme === "dark" ? "Light" : "Dark"}</CommandShortcut>
                </CommandItem>
                <CommandItem
                  value="toggle density compact comfortable table spacing"
                  onSelect={() => runAction(() => themeCtx.setDensity(themeCtx.density === "compact" ? "comfortable" : "compact"))}
                >
                  <Rows3 className="h-4 w-4" />
                  {themeCtx.density === "compact"
                    ? t("commandPalette.preferences.comfortableDensity", { defaultValue: "Switch to comfortable density" })
                    : t("commandPalette.preferences.compactDensity", { defaultValue: "Switch to compact density" })}
                  <CommandShortcut>{themeCtx.density === "compact" ? "Comfortable" : "Compact"}</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
