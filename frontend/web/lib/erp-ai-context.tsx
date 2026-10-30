"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { deriveRouteContext, type AiUiContext } from "@lumiere/query-hooks/ai-ui-context"
import { useErpSession } from "@lumiere/erp-session"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { assistantHistoryScope } from "./assistant-history"
import { assistantErrorQuestion, type AssistantErrorHelp } from "./assistant-error-help"
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

export type OpenErpAiChatOptions = {
  selection?: AiEntitySelection | null
}

type ErpAiChatController = {
  open: () => void
  explainError: (error: AssistantErrorHelp) => void
  errorQuestion: { id: string; text: string } | null
}

const ErpAiChatControllerContext = createContext<ErpAiChatController | null>(null)

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

/** Shell-owned chat open control; modules call `useOpenErpAiChat` instead. */
export function ErpAiChatControllerProvider({
  open,
  children,
}: {
  open: () => void
  children: ReactNode
}) {
  const { identity, organizationId } = useErpSession()
  const companyId = useOperatingCompanyId(organizationId)
  const scope = assistantHistoryScope(identity, organizationId, companyId)
  const currentScope = useRef(scope)
  currentScope.current = scope
  const [request, setRequest] = useState<{ scope: string; id: string; text: string } | null>(null)
  useEffect(() => { setRequest((current) => current?.scope === scope ? current : null) }, [scope])
  const explainError = useCallback((error: AssistantErrorHelp) => {
    if (!scope || currentScope.current !== scope) return
    setRequest({ scope, id: crypto.randomUUID(), text: assistantErrorQuestion(error) })
    open()
  }, [open, scope])
  const errorQuestion = request?.scope === scope ? request : null
  const value = useMemo(() => ({ open, explainError, errorQuestion }), [open, explainError, errorQuestion])
  return (
    <ErpAiChatControllerContext.Provider value={value}>
      {children}
    </ErpAiChatControllerContext.Provider>
  )
}

/** Prepare an editable question in the current scoped conversation; no request is sent. */
export function useExplainErpError(): (message: string, code?: string) => void {
  const controller = useContext(ErpAiChatControllerContext)
  return useCallback((message: string, code?: string) => controller?.explainError({ message, code }), [controller])
}

export function useErpAiErrorQuestion() {
  return useContext(ErpAiChatControllerContext)?.errorQuestion ?? null
}

export function useErpAiRouteContext(): ErpAiRouteContext {
  return useContext(ErpAiRouteContextValue)
}

/**
 * Open the ERP Assistant chat. Optionally pin a module-row selection so the
 * agent receives entity context without the user picking a skill key.
 */
export function useOpenErpAiChat(): (options?: OpenErpAiChatOptions) => void {
  const controller = useContext(ErpAiChatControllerContext)
  const reporter = useErpAiSelectionReporter()

  return useCallback(
    (options?: OpenErpAiChatOptions) => {
      if (options?.selection != null) reporter?.setSelection(options.selection)
      controller?.open()
    },
    [controller, reporter],
  )
}

export type { AiUiContext, AiEntitySelection }
