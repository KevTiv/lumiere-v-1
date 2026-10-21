"use client"

import { createContext, useEffect, useState, type ReactNode } from "react"
import { Monitor, Moon, Search, Settings2, Sun } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "../components/button"
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "../components/popover"
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "../components/sidebar"
import { useTheme, type Theme } from "../components/theme-provider"
import { readPreference, writePreference } from "../lib/theme-storage"
import { cn } from "../lib/utils"
import { HeaderTrailingProvider } from "./dashboard-header"
import { CompanySwitcher } from "../settings/company-switcher"

/** Allows the sidebar to remain usable outside the application shell (e.g. previews). */
export const DashboardWorkspaceContext = createContext(false)

const CONTENT_WIDTH_KEY = "lumiere-content-width"
type ContentWidth = "centered" | "full"

function WorkspaceNavigationTrigger() {
  const { isMobile, openMobile, open } = useSidebar()
  const { t } = useTranslation()
  return <SidebarTrigger aria-label={t("workspaceShell.toggleNavigation", { defaultValue: "Toggle navigation" })}
    aria-expanded={isMobile ? openMobile : open} aria-controls="dashboard-navigation" data-testid="workspace-navigation-toggle" />
}

function MobileCompanySwitcher() {
  const { isMobile, openMobile } = useSidebar()
  return isMobile && !openMobile ? <div className="max-w-32 min-w-0"><CompanySwitcher className="h-8 py-1" /></div> : null
}

function WorkspacePreferences({ width, onWidthChange }: {
  width: ContentWidth
  onWidthChange: (width: ContentWidth) => void
}) {
  const { theme, setTheme, density, setDensity } = useTheme()
  const { t } = useTranslation()
  const { open, setOpen } = useSidebar()
  const modes: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: t("workspaceShell.light", { defaultValue: "Light" }), icon: Sun },
    { value: "dark", label: t("workspaceShell.dark", { defaultValue: "Dark" }), icon: Moon },
    { value: "system", label: t("workspaceShell.system", { defaultValue: "System" }), icon: Monitor },
  ]

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={t("workspaceShell.preferences", { defaultValue: "Workspace preferences" })} />}>
        <Settings2 className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4 p-4">
        <div className="space-y-1">
          <PopoverTitle>{t("workspaceShell.preferences", { defaultValue: "Workspace preferences" })}</PopoverTitle>
          <PopoverDescription className="text-xs">{t("workspaceShell.preferencesDescription", { defaultValue: "Make this workspace comfortable for you." })}</PopoverDescription>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">{t("workspaceShell.appearance", { defaultValue: "Appearance" })}</legend>
          <div className="grid grid-cols-3 gap-1">
            {modes.map(({ value, label, icon: Icon }) => (
              <Button key={value} size="sm" variant={theme === value ? "secondary" : "outline"}
                aria-pressed={theme === value} onClick={() => setTheme(value)}>
                <Icon className="size-3.5" />{label}
              </Button>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">{t("workspaceShell.contentWidth", { defaultValue: "Content width" })}</legend>
          <div className="grid grid-cols-2 gap-1">
            {(["centered", "full"] as const).map((value) => (
              <Button key={value} size="sm" variant={width === value ? "secondary" : "outline"}
                aria-pressed={width === value} onClick={() => onWidthChange(value)}>
                {value === "centered" ? t("workspaceShell.centered", { defaultValue: "Centered" }) : t("workspaceShell.fullWidth", { defaultValue: "Full width" })}
              </Button>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">{t("workspaceShell.density", { defaultValue: "Table density" })}</legend>
          <div className="grid grid-cols-2 gap-1">
            <Button size="sm" variant={density === "comfortable" ? "secondary" : "outline"}
              aria-pressed={density === "comfortable"} onClick={() => setDensity("comfortable")}>
              {t("workspaceShell.comfortable", { defaultValue: "Comfortable" })}
            </Button>
            <Button size="sm" variant={density === "compact" ? "secondary" : "outline"}
              aria-pressed={density === "compact"} onClick={() => setDensity("compact")}>
              {t("workspaceShell.compact", { defaultValue: "Compact" })}
            </Button>
          </div>
        </fieldset>
        <fieldset className="hidden space-y-2 md:block">
          <legend className="text-xs font-medium">{t("workspaceShell.navigation", { defaultValue: "Navigation" })}</legend>
          <div className="grid grid-cols-2 gap-1">
            <Button size="sm" variant={open ? "secondary" : "outline"} aria-pressed={open}
              onClick={() => setOpen(true)}>{t("workspaceShell.expanded", { defaultValue: "Expanded" })}</Button>
            <Button size="sm" variant={!open ? "secondary" : "outline"} aria-pressed={!open}
              onClick={() => setOpen(false)}>{t("workspaceShell.compact", { defaultValue: "Compact" })}</Button>
          </div>
        </fieldset>
      </PopoverContent>
    </Popover>
  )
}

/** Shared shell composition, inspired by Studio Admin's compact header and inset workspace. */
export function DashboardWorkspace({ sidebar, children, overlays, notifications, onOpenSearch, forceCollapsed = false }: {
  sidebar: ReactNode
  children: ReactNode
  overlays?: ReactNode
  notifications?: ReactNode
  onOpenSearch: () => void
  forceCollapsed?: boolean
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const { t } = useTranslation()
  const [width, setWidth] = useState<ContentWidth>("centered")

  useEffect(() => {
    // SidebarProvider already owns the sidebar cookie; read the same preference.
    const persistedSidebar = document.cookie.split("; ").find((entry) => entry.startsWith("sidebar_state="))
    if (persistedSidebar) setSidebarOpen(persistedSidebar.split("=")[1] !== "false")
    const persistedWidth = readPreference(CONTENT_WIDTH_KEY)
    if (persistedWidth === "centered" || persistedWidth === "full") setWidth(persistedWidth)
  }, [])

  const changeWidth = (next: ContentWidth) => {
    setWidth(next)
    writePreference(CONTENT_WIDTH_KEY, next)
  }

  return (
    <DashboardWorkspaceContext value={true}>
      <SidebarProvider open={forceCollapsed ? false : sidebarOpen} onOpenChange={setSidebarOpen}
        className="h-svh min-h-0 overflow-hidden bg-muted/30 text-foreground"
        style={{ "--sidebar-width-icon": "4rem" } as React.CSSProperties}>
        {sidebar}
        <SidebarInset className="min-h-0 min-w-0 overflow-auto scroll-smooth bg-transparent">
          <header data-testid="workspace-header" className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background/95 px-3 backdrop-blur-sm sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <WorkspaceNavigationTrigger />
              <span className="h-4 w-px bg-border" aria-hidden="true" />
              <MobileCompanySwitcher />
              <Button variant="ghost" onClick={onOpenSearch} aria-label={t("workspaceShell.search", { defaultValue: "Search modules and records" })}
                data-testid="workspace-search" className="min-w-0 gap-2 text-muted-foreground sm:w-64 sm:justify-start">
                <Search className="size-4 shrink-0" />
                <span className="hidden truncate text-xs sm:inline sm:text-sm">{t("workspaceShell.search", { defaultValue: "Search modules and records" })}</span>
                <kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] sm:inline-block">⌘ / Ctrl K</kbd>
              </Button>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <WorkspacePreferences width={width} onWidthChange={changeWidth} />
              {notifications}
            </div>
          </header>
          <HeaderTrailingProvider value={null}>
            <div data-testid="workspace-content" data-content-width={width}
              className={cn("mx-auto w-full min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7", width === "centered" && "max-w-[1600px]")}>
              {children}
            </div>
          </HeaderTrailingProvider>
        </SidebarInset>
        {overlays}
      </SidebarProvider>
    </DashboardWorkspaceContext>
  )
}
