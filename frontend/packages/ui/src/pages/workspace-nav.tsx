"use client"

import { useState, type MouseEvent } from "react"
import { Check, ChevronDown, Settings2 } from "lucide-react"
import { Button } from "../components/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "../components/dropdown-menu"
import { ContextTabsList, ContextTabsTrigger } from "../components/context-tabs"
import type { ModuleTab, ModuleWorkspaceNav } from "../lib/module-types"
import { resolveWorkspaceNavigation } from "../lib/workspace-navigation"
import { cn } from "../lib/utils"
import { workspaceStyles } from "../lib/workspace-styles"

interface WorkspaceNavProps {
  moduleId: string
  tabs: readonly ModuleTab[]
  config: ModuleWorkspaceNav
  activeTab: string
  onTabChange: (tabId: string) => void
  hrefForTab: (tabId: string) => string
}

export function WorkspaceNav({ moduleId, tabs, config, activeTab, onTabChange, hrefForTab }: WorkspaceNavProps) {
  const [overflowOpen, setOverflowOpen] = useState(false)
  const { workspaces, overflow } = resolveWorkspaceNavigation(tabs, config)
  const activeWorkspace = workspaces.find((group) => group.tabs.some((tab) => tab.id === activeTab))
  const activeOverflow = overflow.find((group) => group.tabs.some((tab) => tab.id === activeTab))
  const selectedTab = tabs.find((tab) => tab.id === activeTab)
  const localTabs = activeWorkspace?.tabs ?? activeOverflow?.tabs ?? (selectedTab ? [selectedTab] : [])
  const navigate = (event: MouseEvent<HTMLAnchorElement>, tabId: string) => {
    // Preserve open-in-new-tab and other native link gestures.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    if (tabId !== activeTab) onTabChange(tabId)
    setOverflowOpen(false)
  }

  return (
    <div className="min-w-0 space-y-3" data-testid={`module-tabs-${moduleId}`}>
      <nav aria-label={config.label ?? "Workspaces"} className={workspaceStyles.workspaceNav} data-ui="workspace-nav">
        {workspaces.map((workspace) => (
          <a
            key={workspace.id}
            href={hrefForTab(activeWorkspace?.id === workspace.id ? activeTab : workspace.tabs[0]!.id)}
            onClick={(event) => navigate(event, activeWorkspace?.id === workspace.id ? activeTab : workspace.tabs[0]!.id)}
            aria-current={activeWorkspace?.id === workspace.id ? "page" : undefined}
            data-testid={`module-workspace-${moduleId}-${workspace.id}`}
            className={cn(
              workspaceStyles.workspaceLink,
              activeWorkspace?.id === workspace.id && workspaceStyles.workspaceLinkActive,
            )}
          >
            {workspace.label}
          </a>
        ))}
        {overflow.length > 0 && (
          <DropdownMenu open={overflowOpen} onOpenChange={setOverflowOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant={activeOverflow ? "secondary" : "ghost"}
                size="sm"
                className="h-auto min-h-11 min-w-0 max-w-full gap-2 whitespace-normal text-left sm:ml-auto"
                data-testid={`module-workspace-${moduleId}-overflow`}
              >
                <Settings2 className="size-3.5" aria-hidden />
                <span className="min-w-0 [overflow-wrap:anywhere]">{config.overflowLabel ?? "Advanced / Configuration"}</span>
                <ChevronDown className="size-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
              {overflow.map((group, index) => (
                <DropdownMenuGroup key={group.id}>
                  {index > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                  {group.tabs.map((tab) => (
                    <DropdownMenuItem key={tab.id} className="min-h-11" asChild>
                      <a
                        href={hrefForTab(tab.id)}
                        onClick={(event) => navigate(event, tab.id)}
                        aria-current={activeTab === tab.id ? "page" : undefined}
                        data-testid={`module-workspace-item-${moduleId}-${tab.id}`}
                      >
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{tab.label}</span>
                        {activeTab === tab.id && <Check className="size-4" aria-hidden />}
                      </a>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>
      <ContextTabsList aria-label={`${activeWorkspace?.label ?? activeOverflow?.label ?? "Workspace"} views`}>
        {localTabs.map((tab) => (
          <ContextTabsTrigger
            key={tab.id}
            value={tab.id}
            data-testid={`module-tab-${moduleId}-${tab.id}`}
          >
            {tab.label}
          </ContextTabsTrigger>
        ))}
      </ContextTabsList>
    </div>
  )
}
