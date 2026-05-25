"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type { AiEntitySelection } from "./ai-ui-context"

export type { AiEntitySelection } from "./ai-ui-context"

export type ErpAiSelectionState = {
  activeTab: string | null
  selection: AiEntitySelection | null
}

export type ErpAiSelectionReporter = {
  setActiveTab: (activeTab: string | null) => void
  setSelection: (selection: AiEntitySelection | null) => void
  clearSelection: () => void
}

const SelectionStateContext = createContext<ErpAiSelectionState>({
  activeTab: null,
  selection: null,
})

const SelectionReporterContext = createContext<ErpAiSelectionReporter | null>(null)

export function ErpAiSelectionStateProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTabState] = useState<string | null>(null)
  const [selection, setSelectionState] = useState<AiEntitySelection | null>(null)

  const setActiveTab = useCallback((nextActiveTab: string | null) => {
    setActiveTabState((prev) => {
      if (prev !== nextActiveTab) {
        setSelectionState(null)
      }
      return nextActiveTab
    })
  }, [])

  const setSelection = useCallback((nextSelection: AiEntitySelection | null) => {
    setSelectionState(nextSelection)
    if (nextSelection?.activeTab) {
      setActiveTabState(nextSelection.activeTab)
    }
  }, [])

  const clearSelection = useCallback(() => {
    setSelectionState(null)
  }, [])

  const state = useMemo(() => ({ activeTab, selection }), [activeTab, selection])
  const reporter = useMemo(
    () => ({ setActiveTab, setSelection, clearSelection }),
    [clearSelection, setActiveTab, setSelection],
  )

  return (
    <SelectionStateContext.Provider value={state}>
      <SelectionReporterContext.Provider value={reporter}>
        {children}
      </SelectionReporterContext.Provider>
    </SelectionStateContext.Provider>
  )
}

export function useErpAiSelectionState(): ErpAiSelectionState {
  return useContext(SelectionStateContext)
}

export function useErpAiSelectionReporter(): ErpAiSelectionReporter | null {
  return useContext(SelectionReporterContext)
}
