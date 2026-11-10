"use client"

import {
  createContext,
  useContext,
  useState,
  type ComponentType,
  type ReactNode,
} from "react"
import type { HistoryBounds } from "@lumiere/erp-shared/history-period"
import type { DashboardSection } from "../lib/dashboard-types"
import type { PageCompositionStartingLayout } from "../lib/page-composition"

/** The application supplies persistence and data; module pages keep their renderers. */
export interface PageCompositionMountProps {
  moduleId: string
  pageId: string
  title: string
  sections?: readonly DashboardSection[]
  startingLayouts?: readonly PageCompositionStartingLayout[]
  /** Ignore old placements for native sections that now render outside composition. */
  fixedWidgetIds?: readonly string[]
  /** Insights are optional, start empty, and cannot replace the page's business content. */
  placement?: "dashboard" | "insights"
  /** The owning page supplies its resolved period; null means the selection is invalid. */
  historyBounds?: HistoryBounds | null
  historyTimeZone?: string
  /** Explains page controls (such as currency) that do not scope saved widgets. */
  savedWidgetScopeNote?: string
  /** Header target for the edit launcher; null means the target has not mounted. */
  actionTarget?: HTMLElement | null
  isLoading?: boolean
  children?: ReactNode
}

const PageCompositionActionTargetContext = createContext<
  HTMLElement | null | undefined
>(undefined)
export const PageCompositionActionTargetProvider =
  PageCompositionActionTargetContext.Provider

export function usePageCompositionActionSlot() {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  return { target, slot: <div ref={setTarget} className="contents" /> }
}

const PageCompositionHostContext =
  createContext<ComponentType<PageCompositionMountProps> | null>(null)

export function PageCompositionHostProvider({
  component,
  children,
}: {
  component: ComponentType<PageCompositionMountProps>
  children: ReactNode
}) {
  return (
    <PageCompositionHostContext.Provider value={component}>
      {children}
    </PageCompositionHostContext.Provider>
  )
}

/** Standalone module fixtures and consumers retain their original content. */
export function ModulePageComposition(props: PageCompositionMountProps) {
  const Host = useContext(PageCompositionHostContext)
  const inheritedTarget = useContext(PageCompositionActionTargetContext)
  return Host ? (
    <Host
      {...props}
      actionTarget={
        props.actionTarget === undefined ? inheritedTarget : props.actionTarget
      }
    />
  ) : (
    <>{props.children}</>
  )
}
