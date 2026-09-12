"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  BookOpen,
  Sparkles,
  BookMarked,
} from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { useRBAC } from "@/lib/rbac-context"
import { buildNavGroups, type NavGroup } from "../lib/navigation-catalog"
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

  const navGroups = useMemo((): NavGroup[] => buildNavGroups(t), [t])

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
