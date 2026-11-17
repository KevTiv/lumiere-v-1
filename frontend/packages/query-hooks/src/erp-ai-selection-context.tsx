"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

const emptySelection: ErpAiSelectionState = { activeTab: null, selection: null }
const SelectionStateContext = createContext(emptySelection)

const SelectionReporterContext = createContext<ErpAiSelectionReporter | null>(null)

export function ErpAiSelectionStateProvider({
  children,
  scopeKey = null,
}: {
  children: ReactNode
  scopeKey?: string | null
}) {
  const [tracked, setTracked] = useState<{ scopeKey: string | null; state: ErpAiSelectionState }>()
  const state = tracked?.scopeKey === scopeKey ? tracked.state : emptySelection

  useEffect(() => {
    setTracked(current => current?.scopeKey === scopeKey ? current : undefined)
  }, [scopeKey])

  const update = useCallback((transform: (state: ErpAiSelectionState) => ErpAiSelectionState) => {
    setTracked(current => {
      const previous = current?.scopeKey === scopeKey ? current.state : emptySelection
      const next = transform(previous)
      return current?.scopeKey === scopeKey && previous === next ? current : { scopeKey, state: next }
    })
  }, [scopeKey])

  const setActiveTab = useCallback((activeTab: string | null) => {
    update(previous => previous.activeTab === activeTab ? previous : { activeTab, selection: null })
  }, [update])

  const setSelection = useCallback((selection: AiEntitySelection | null) => {
    update(previous => ({ activeTab: selection?.activeTab ?? previous.activeTab, selection }))
  }, [update])

  const clearSelection = useCallback(() => setSelection(null), [setSelection])

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
