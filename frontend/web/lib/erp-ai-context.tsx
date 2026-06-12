"use client"

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { deriveRouteContext, type AiUiContext } from "@lumiere/query-hooks/ai-ui-context"
import {
  ErpAiSelectionStateProvider,
  useErpAiSelectionReporter,
  useErpAiSelectionState,
  type AiEntitySelection,
} from "@lumiere/query-hooks/erp-ai-selection-context"

export type ErpAiRouteContext = {
  route: string
  module: string | null
  activeTab: string | null
  selection: AiEntitySelection | null
}

const ErpAiRouteContextValue = createContext<ErpAiRouteContext>({
  route: "/",
  module: null,
  activeTab: null,
  selection: null,
})

function ErpAiRouteContextBridge({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlActiveTab = searchParams.get("tab")
  const selectionState = useErpAiSelectionState()
  const selectionReporter = useErpAiSelectionReporter()
  const activeTab = selectionState.activeTab ?? urlActiveTab

  useEffect(() => {
    selectionReporter?.setActiveTab(null)
  }, [pathname, selectionReporter])

  const value = useMemo(
    () => ({
      ...deriveRouteContext(pathname ?? "/"),
      activeTab,
      selection: selectionState.selection,
    }),
    [activeTab, pathname, selectionState.selection],
  )

  return <ErpAiRouteContextValue.Provider value={value}>{children}</ErpAiRouteContextValue.Provider>
}

export function ErpAiRouteContextProvider({ children }: { children: ReactNode }) {
  return (
    <ErpAiSelectionStateProvider>
      <ErpAiRouteContextBridge>{children}</ErpAiRouteContextBridge>
    </ErpAiSelectionStateProvider>
  )
}

export function useErpAiRouteContext(): ErpAiRouteContext {
  return useContext(ErpAiRouteContextValue)
}

export type { AiUiContext }
