"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

/** A presentation request, never a command or permission grant. */
export interface AssistantNativeFormRequest {
  requestId: string
  scopeKey: string
  moduleId: string
  tabId: string
  /** User-authored input for the existing advisory form assistant. */
  prompt?: string
  /** Report whether the destination opened the form, independently of any later save. */
  onPresentationOutcome?: (status: AssistantNativeFormPresentationOutcome) => void
  /** Return to the initiating checklist after the native form closes. */
  onActivationReturn?: (result: NativeFormActivationResult) => void
}

export type AssistantNativeFormStatus =
  | "opened"
  | "denied"
  | "unavailable"
  | "busy"
export type AssistantNativeFormPresentationOutcome =
  | AssistantNativeFormStatus
  | "cancelled"
  | "scope_changed"
export interface AssistantNativeFormOutcome {
  requestId: string
  scopeKey: string
  status: AssistantNativeFormStatus
}

export type NativeFormActivationResult =
  | { status: "saved"; recordId: string }
  | { status: "cancelled" | "denied" | "unavailable" | "busy" | "scope_changed" }

interface PendingNativeFormRequest extends AssistantNativeFormRequest {
  expiresAt: number
}

export function useAssistantNativeFormController(scopeKey: string | null) {
  const currentScope = useRef(scopeKey)
  currentScope.current = scopeKey
  const [pending, setPending] = useState<PendingNativeFormRequest | null>(null)
  const pendingRef = useRef<PendingNativeFormRequest | null>(null)
  const activationRef = useRef<AssistantNativeFormRequest | null>(null)
  const [outcome, setOutcome] = useState<AssistantNativeFormOutcome | null>(
    null,
  )

  useEffect(() => {
    const request = pendingRef.current
    if (request && request.scopeKey !== scopeKey) {
      pendingRef.current = null
      request.onPresentationOutcome?.("scope_changed")
      request.onActivationReturn?.({ status: "scope_changed" })
    }
    const activation = activationRef.current
    if (activation && activation.scopeKey !== scopeKey) {
      activationRef.current = null
      activation.onActivationReturn?.({ status: "scope_changed" })
    }
    setPending((value) => (value?.scopeKey === scopeKey ? value : null))
    setOutcome((value) => (value?.scopeKey === scopeKey ? value : null))
  }, [scopeKey])

  const requestForm = useCallback(
    (
      request: AssistantNativeFormRequest,
    ): "pending" | "busy" | "scope_changed" => {
      if (!currentScope.current || request.scopeKey !== currentScope.current)
        return "scope_changed"
      if (pendingRef.current?.scopeKey === currentScope.current || activationRef.current?.scopeKey === currentScope.current) return "busy"
      if (
        !request.requestId ||
        !request.moduleId ||
        !request.tabId ||
        (request.prompt?.length ?? 0) > 4000
      )
        return "scope_changed"
      const bounded = { ...request, expiresAt: Date.now() + 15_000 }
      pendingRef.current = bounded
      setPending(bounded)
      setOutcome(null)
      return "pending"
    },
    [],
  )

  const isCurrent = useCallback((requestId: string) => {
    const request = pendingRef.current
    return (
      request?.requestId === requestId &&
      request.scopeKey === currentScope.current &&
      request.expiresAt > Date.now()
    )
  }, [])

  const settle = useCallback(
    (requestId: string, status: AssistantNativeFormStatus) => {
      const request = pendingRef.current
      if (
        !request ||
        request.requestId !== requestId ||
        request.scopeKey !== currentScope.current
      )
        return
      pendingRef.current = null
      setPending(null)
      request.onPresentationOutcome?.(status)
      if (request.onActivationReturn) {
        if (status === "opened") activationRef.current = request
        else request.onActivationReturn({ status })
        return
      }
      if (!request.onPresentationOutcome) setOutcome({ requestId, scopeKey: request.scopeKey, status })
    },
    [],
  )

  const cancel = useCallback((requestId: string) => {
    const request = pendingRef.current
    if (request?.requestId !== requestId) return
    pendingRef.current = null
    setPending(null)
    request.onPresentationOutcome?.("cancelled")
  }, [])

  const finishActivation = useCallback((requestId: string, result: NativeFormActivationResult) => {
    const request = activationRef.current
    if (!request || request.requestId !== requestId || request.scopeKey !== currentScope.current) return
    activationRef.current = null
    request.onActivationReturn?.(result)
  }, [])

  const abandonActivation = useCallback((requestId: string) => {
    if (activationRef.current?.requestId === requestId) activationRef.current = null
  }, [])

  useEffect(() => {
    if (!pending || pending.scopeKey !== scopeKey) return
    const timer = setTimeout(
      () => settle(pending.requestId, "unavailable"),
      Math.max(0, pending.expiresAt - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [pending, scopeKey, settle])

  return {
    scopeKey,
    pending: pending?.scopeKey === scopeKey ? pending : null,
    outcome: outcome?.scopeKey === scopeKey ? outcome : null,
    requestForm,
    isCurrent,
    settle,
    cancel,
    finishActivation,
    abandonActivation,
  }
}

export type AssistantNativeFormController = ReturnType<
  typeof useAssistantNativeFormController
>
const AssistantNativeFormContext =
  createContext<AssistantNativeFormController | null>(null)

/** Keep this provider in the authenticated shell, with an actor/org/company scope. */
export function AssistantNativeFormProvider({
  value,
  children,
}: {
  value: AssistantNativeFormController
  children: ReactNode
}) {
  return (
    <AssistantNativeFormContext.Provider value={value}>
      {children}
    </AssistantNativeFormContext.Provider>
  )
}

export function useAssistantNativeForms() {
  return useContext(AssistantNativeFormContext)
}
