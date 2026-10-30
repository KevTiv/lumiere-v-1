"use client"

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react"
import type { GuideDocument, GuideDraft } from "@lumiere/ui/lib/assistant-guide-types"

type GuideQuestionHandler = (guide: GuideDraft | GuideDocument, question: string, draftOverride?: GuideDraft) => Promise<string>
type GuideConversation = {
  ready: boolean
  register: (handler: GuideQuestionHandler) => () => void
  ask: GuideQuestionHandler
}

const Context = createContext<GuideConversation | null>(null)

/** The document page uses the shell's existing conversation, never a second session. */
export function AssistantGuideConversationProvider({ children }: { children: ReactNode }) {
  const handler = useRef<GuideQuestionHandler | null>(null)
  const [ready, setReady] = useState(false)
  const register = useCallback((next: GuideQuestionHandler) => {
    handler.current = next
    setReady(true)
    return () => {
      if (handler.current === next) { handler.current = null; setReady(false) }
    }
  }, [])
  const ask = useCallback<GuideQuestionHandler>((guide, question, draftOverride) => {
    if (!handler.current) return Promise.reject(new Error("The assistant conversation is not ready. Try again."))
    return handler.current(guide, question, draftOverride)
  }, [])
  const value = useMemo(() => ({ ready, register, ask }), [ready, register, ask])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useAssistantGuideConversation() {
  const context = useContext(Context)
  if (!context) throw new Error("Assistant guide conversation requires the ERP shell")
  return context
}
