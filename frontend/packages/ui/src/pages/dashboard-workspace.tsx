"use client"

import { createContext, Fragment, useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, LogOut, Monitor, Moon, Search, Sun, UserRound } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "../components/button"
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "../components/popover"
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "../components/sidebar"
import { useTheme, type Density, type Theme } from "../components/theme-provider"
import { readPreference, writePreference } from "../lib/theme-storage"
import { cn } from "../lib/utils"
import { HeaderTrailingProvider } from "./dashboard-header"
import { CompanySwitcher } from "../settings/company-switcher"
import { useRBAC } from "../lib/rbac-context"

/** Allows the sidebar to remain usable outside the application shell (e.g. previews). */
export const DashboardWorkspaceContext = createContext(false)

const CONTENT_WIDTH_KEY = "lumiere-content-width"
type ContentWidth = "centered" | "full"
type WorkspaceTool = "assistant" | "notebook"
interface WorkspaceDock {
  container: HTMLElement | null
  docked: WorkspaceTool | null
  canDock: (tool: WorkspaceTool) => boolean
}

const DOCK_MIN_REM: Record<WorkspaceTool, number> = { assistant: 22.5, notebook: 25 }
// Leave 32rem for work, 4rem for its gutters, 3rem for icon navigation, and .75rem for the gap.
const WORKSPACE_MIN_REM = 32 + 4 + 3 + 0.75

function formatBreadcrumbSegment(segment: string): string {
  if (/^\d+$/.test(segment)) return `#${segment}`
  return segment
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function WorkspaceBreadcrumbs() {
  const pathname = usePathname()
  if (!pathname || pathname === "/") return null
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 0) return null

  return (
    <nav
      aria-label="Breadcrumb"
      data-testid="workspace-breadcrumbs"
      className="hidden min-w-0 items-center gap-1 text-xs text-muted-foreground md:flex"
    >
      {segments.map((segment, index) => {
        const href = `/${segments.slice(0, index + 1).join("/")}`
        const isLast = index === segments.length - 1
        const label = formatBreadcrumbSegment(segment)
        return (
          <Fragment key={href}>
            {index > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />}
            {isLast ? (
              <span className="truncate font-medium text-foreground max-w-[14rem]" aria-current="page">
                {label}
              </span>
            ) : (
              <Link
                href={href}
                className="truncate max-w-[10rem] rounded px-1 py-0.5 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {label}
              </Link>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}

function WorkspaceNavigationTrigger() {
  const { isMobile, openMobile, open } = useSidebar()
  const { t } = useTranslation()
  return <SidebarTrigger aria-label={t("workspaceShell.toggleNavigation", { defaultValue: "Toggle navigation" })}
    aria-expanded={isMobile ? openMobile : open} aria-controls="dashboard-navigation" data-testid="workspace-navigation-toggle" />
}

function MobileCompanySwitcher() {
  const { isMobile, openMobile } = useSidebar()
  return isMobile && !openMobile ? <div className="max-w-32 min-w-0"><CompanySwitcher className="h-8 max-w-full py-1" /></div> : null
}

export interface DashboardAccountProps {
  userProfile?: { name?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null }
  onSignOut?: () => void | Promise<void>
}

/** Best available human label: full name, then first/last, then email. */
function accountUserLabel(profile: DashboardAccountProps["userProfile"]): string {
  const name = profile?.name?.trim()
  if (name) return name
  const parts = [profile?.firstName, profile?.lastName].map((part) => part?.trim()).filter(Boolean)
  return parts.length ? parts.join(" ") : profile?.email?.trim() ?? ""
}

function WorkspaceAccountMenu({
  userProfile,
  onSignOut,
  contentWidth,
  onContentWidthChange,
}: DashboardAccountProps & {
  contentWidth: ContentWidth
  onContentWidthChange: (next: ContentWidth) => void
}) {
  const { theme, setTheme, density, setDensity } = useTheme()
  const { t } = useTranslation()
  const { open, setOpen } = useSidebar()
  const { currentUser, roles } = useRBAC()
  const [signingOut, setSigningOut] = useState(false)
  const userLabel = accountUserLabel(userProfile) || currentUser?.name?.trim() || t("nav.signedIn")
  const roleId = currentUser?.roles[0]
  const roleLabel = roleId ? roles.find((role) => role.id === roleId)?.name || roleId : t("nav.noRole")
  const modes: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: t("workspaceShell.light", { defaultValue: "Light" }), icon: Sun },
    { value: "dark", label: t("workspaceShell.dark", { defaultValue: "Dark" }), icon: Moon },
    { value: "system", label: t("workspaceShell.system", { defaultValue: "System" }), icon: Monitor },
  ]
  const densities: { value: Density; label: string }[] = [
    { value: "comfortable", label: t("workspaceShell.comfortable", { defaultValue: "Comfortable" }) },
    { value: "compact", label: t("workspaceShell.compact", { defaultValue: "Compact" }) },
  ]

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon" data-testid="workspace-account-menu" aria-label={t("workspaceShell.accountAndPreferences", { defaultValue: "Account and preferences" })} />}>
        <UserRound className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4 p-4">
        <div className="space-y-1">
          <PopoverTitle>{t("workspaceShell.accountAndPreferences", { defaultValue: "Account and preferences" })}</PopoverTitle>
          <PopoverDescription className="text-xs">{t("workspaceShell.preferencesDescription", { defaultValue: "Make this workspace comfortable for you." })}</PopoverDescription>
        </div>
        <div className="flex min-w-0 items-center gap-3 border-b pb-4" data-testid="workspace-user">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted"><UserRound className="size-4" /></div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{userLabel}</p>
            <p className="truncate text-xs text-muted-foreground">{roleLabel}</p>
          </div>
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
          <legend className="text-xs font-medium">{t("workspaceShell.density", { defaultValue: "Density" })}</legend>
          <div className="grid grid-cols-2 gap-1">
            {densities.map(({ value, label }) => (
              <Button key={value} size="sm" variant={density === value ? "secondary" : "outline"}
                aria-pressed={density === value} onClick={() => setDensity(value)}
                data-testid={`workspace-density-${value}`}>
                {label}
              </Button>
            ))}
          </div>
        </fieldset>
        <fieldset className="hidden space-y-2 md:block">
          <legend className="text-xs font-medium">{t("workspaceShell.contentWidth")}</legend>
          <div className="grid grid-cols-2 gap-1">
            <Button size="sm" variant={contentWidth === "centered" ? "secondary" : "outline"}
              aria-pressed={contentWidth === "centered"} onClick={() => onContentWidthChange("centered")}>
              {t("workspaceShell.centered", { defaultValue: "Centered" })}
            </Button>
            <Button size="sm" variant={contentWidth === "full" ? "secondary" : "outline"}
              aria-pressed={contentWidth === "full"} onClick={() => onContentWidthChange("full")}>
              {t("workspaceShell.fullWidth", { defaultValue: "Full width" })}
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
        {onSignOut && <div className="border-t pt-3">
          <Button variant="outline" size="sm" className="w-full justify-start" data-testid="workspace-sign-out"
            disabled={signingOut} onClick={async () => {
              setSigningOut(true)
              try { await onSignOut() } finally { setSigningOut(false) }
            }}>
            <LogOut className="size-4" />{t("nav.signOut")}
          </Button>
        </div>}
      </PopoverContent>
    </Popover>
  )
}

/** Shared shell composition, inspired by Linear's flush split-pane sidebar and crisp inset canvas. */
export function DashboardWorkspace({ sidebar, children, overlays, dockRequest, notifications, headerTools, onOpenSearch, forceCollapsed = false, userProfile, onSignOut }: {
  sidebar: ReactNode | ((collapsed: boolean) => ReactNode)
  children: ReactNode
  overlays?: ReactNode | ((dock: WorkspaceDock) => ReactNode)
  dockRequest?: WorkspaceTool | null
  notifications?: ReactNode
  headerTools?: ReactNode
  onOpenSearch: () => void
  forceCollapsed?: boolean
} & DashboardAccountProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const { t } = useTranslation()
  const [width, setWidth] = useState<ContentWidth>("centered")
  const [shortcutLabel, setShortcutLabel] = useState("⌘K")
  const shell = useRef<HTMLDivElement>(null)
  const [dockContainer, setDockContainer] = useState<HTMLDivElement | null>(null)
  const [availableRem, setAvailableRem] = useState(0)
  const managesTools = typeof overlays === "function"

  const handleWidthChange = (next: ContentWidth) => {
    setWidth(next)
    writePreference(CONTENT_WIDTH_KEY, next)
  }

  useEffect(() => {
    if (typeof navigator !== "undefined" && !/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)) {
      setShortcutLabel("Ctrl K")
    }
  }, [])

  useEffect(() => {
    const element = shell.current
    if (!managesTools || !element) return
    const measure = () => {
      const styles = getComputedStyle(element)
      const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize)
      const contentWidth = element.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight)
      // The two workspace borders are outside its content width.
      setAvailableRem((contentWidth - 2) / rootSize)
    }
    measure()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    observer?.observe(element)
    if (!observer) window.addEventListener("resize", measure)
    return () => {
      observer?.disconnect()
      if (!observer) window.removeEventListener("resize", measure)
    }
  }, [managesTools])

  const canDock = (tool: WorkspaceTool) => availableRem >= WORKSPACE_MIN_REM + DOCK_MIN_REM[tool]
  const docked = dockRequest && canDock(dockRequest) ? dockRequest : null
  const collapseNavigation = forceCollapsed || docked !== null

  useEffect(() => {
    // SidebarProvider already owns the sidebar cookie; read the same preference.
    const persistedSidebar = document.cookie.split("; ").find((entry) => entry.startsWith("sidebar_state="))
    if (persistedSidebar) setSidebarOpen(persistedSidebar.split("=")[1] !== "false")
    const persistedWidth = readPreference(CONTENT_WIDTH_KEY)
    if (persistedWidth === "centered" || persistedWidth === "full") setWidth(persistedWidth)
  }, [])

  return (
    <DashboardWorkspaceContext value={true}>
      <SidebarProvider ref={shell} resizable open={collapseNavigation ? false : sidebarOpen} onOpenChange={setSidebarOpen}
        className="h-svh min-h-0 overflow-hidden bg-sidebar text-foreground"
        style={{ "--sidebar-width-icon": "3rem" } as React.CSSProperties}>
        <div data-testid="erp-workspace-stack" className="relative isolate flex min-h-0 min-w-0 flex-1 overflow-hidden bg-sidebar [&_[data-slot=sidebar-container]]:absolute [&_[data-slot=sidebar-container]]:h-full">
          {typeof sidebar === "function" ? sidebar(collapseNavigation) : sidebar}
          <SidebarInset className="min-h-0 min-w-0 overflow-auto scroll-smooth bg-background md:my-2 md:mr-2 md:rounded-xl md:border md:border-border/60 md:shadow-xs">
            <header data-testid="workspace-header" className="sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background/95 px-3 backdrop-blur-sm sm:px-4">
              <div className="flex min-w-0 items-center gap-2">
                <WorkspaceNavigationTrigger />
                <span className="h-4 w-px bg-border/70" aria-hidden="true" />
                <WorkspaceBreadcrumbs />
                <MobileCompanySwitcher />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" onClick={onOpenSearch} aria-label={t("workspaceShell.search", { defaultValue: "Search modules and records" })}
                  data-testid="workspace-search" className="h-8 min-w-0 gap-2 border border-transparent text-muted-foreground hover:border-border/60 hover:bg-muted/60 sm:w-52 sm:justify-start">
                  <Search className="size-3.5 shrink-0" />
                  <span className="hidden truncate text-xs sm:inline">{t("workspaceShell.searchShort", { defaultValue: "Search..." })}</span>
                  <kbd className="ml-auto hidden rounded border border-border/80 bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground sm:inline-block">{shortcutLabel}</kbd>
                </Button>
                {headerTools}
                <WorkspaceAccountMenu
                  userProfile={userProfile}
                  onSignOut={onSignOut}
                  contentWidth={width}
                  onContentWidthChange={handleWidthChange}
                />
                {notifications}
              </div>
            </header>
            <HeaderTrailingProvider value={null}>
              <div data-testid="workspace-content" data-content-width={width}
                className={cn("mx-auto w-full min-w-0 flex-1 px-4 py-4 sm:px-6 lg:px-7 lg:py-6", width === "centered" && "max-w-[1600px]")}>
                {children}
              </div>
            </HeaderTrailingProvider>
          </SidebarInset>
        </div>
        {managesTools && <div
          ref={setDockContainer}
          data-testid="workspace-tool-host"
          data-docked={docked ?? undefined}
          className={cn(
            "min-h-0 min-w-0",
            docked ? "relative flex-none overflow-hidden bg-background md:my-2 md:mr-2 md:rounded-xl md:border md:border-border/60 md:shadow-xs" : "contents",
          )}
          style={docked ? { width: `${DOCK_MIN_REM[docked]}rem` } : undefined}
        />}
        {typeof overlays === "function" ? overlays({ container: dockContainer, docked, canDock }) : overlays}
      </SidebarProvider>
    </DashboardWorkspaceContext>
  )
}
