"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  BookOpen,
  Sparkles,
  BookMarked,
} from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import { useRBAC } from "@/lib/rbac-context"
import { buildNavGroups, type NavGroup } from "../lib/navigation-catalog"
import { isRecordSearchQuery } from "../lib/record-search"
import { RecordSearchResults, type RecordSearchSummary } from "./erp-command-palette-records"
import { isFirstOrgSurfaceAdmitted } from "../lib/product-surface-catalog"
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

export interface ErpCommandPaletteProps {
  onOpenAIChat?: () => void
  onOpenNotebook?: () => void
  onOpenJournal?: () => void
  /** Apply the fail-closed first-test-organization product admission profile. */
  firstOrgProfile?: boolean
  /** Record page of a model (e.g. `recordPageHref`); models with no page fall back to their module tab. */
  recordHref?: (model: string, id: string) => string | undefined
}

export function ErpCommandPalette({
  onOpenAIChat,
  onOpenNotebook,
  onOpenJournal,
  firstOrgProfile = false,
  recordHref,
}: ErpCommandPaletteProps) {
  const [open, setOpenState] = useState(false)
  const [search, setSearch] = useState("")
  const [recordSummary, setRecordSummary] = useState<RecordSearchSummary | null>(null)
  const { organizationId } = useErpSession()
  const setOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setOpenState(next)
    // The next opening starts from an empty query.
    setSearch("")
    setRecordSummary(null)
  }, [])
  const router = useRouter()
  const { checkPermission, isAdmin } = useRBAC()
  const { t } = useTranslation()

  const userIsAdmin = isAdmin()
  const navGroups = useMemo(
    (): NavGroup[] => buildNavGroups(t, { firstOrgProfile, isAdmin: userIsAdmin }),
    [firstOrgProfile, t, userIsAdmin],
  )
  const quickActionIsVisible = useCallback(
    (surfaceId: string) =>
      !firstOrgProfile || isFirstOrgSurfaceAdmitted(surfaceId, userIsAdmin),
    [firstOrgProfile, userIsAdmin],
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

  // Record reads start only while the palette is open and the query is long enough, and only
  // for modules the user can read (the same gate as the module list above).
  const recordSearchActive =
    open && organizationId != null && organizationId > 0 && isRecordSearchQuery(search)
  const allowedResourceKey = accessibleNavGroups
    .flatMap((group) => group.items.map((item) => item.resource))
    .sort()
    .join("\n")
  const allowedResources = useMemo(() => new Set(allowedResourceKey.split("\n")), [allowedResourceKey])
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

  const visibleAiChat = quickActionIsVisible("ai-assistant") ? onOpenAIChat : undefined
  const visibleNotebook = quickActionIsVisible("notebook") ? onOpenNotebook : undefined
  const visibleJournal = quickActionIsVisible("journal") ? onOpenJournal : undefined
  const hasQuickActions = visibleAiChat || visibleNotebook || visibleJournal

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

          {recordSearchActive && organizationId != null ? (
            <RecordSearchResults
              organizationId={BigInt(organizationId)}
              query={search}
              allowedResources={allowedResources}
              recordHref={resolveRecordHref}
              onNavigate={navigate}
              onSummary={setRecordSummary}
            />
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
