"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react"
import { useSearchParams } from "next/navigation"
import { HttpResponseError } from "@lumiere/api-client/response-error"
import {
  useAiChatMessage,
  useAiChatMessages,
  useAiChatSession,
  useAiChatSessions,
  type AiChatReadScope,
} from "@lumiere/query-hooks/hooks/ai-memory"
import { assistantHistoryScope, rememberAssistantSession, scopedAssistantSession } from "./assistant-history"

const THREAD_PARAM = "assistantThread"
const MESSAGE_PARAM = "assistantMessage"
const COMPANY_PARAM = "assistantCompany"
const MAX_DRAFTS = 10

function accessLost(error: unknown) {
  return error instanceof HttpResponseError && (error.status === 401 || error.status === 403 || error.status === 404)
}

export function assistantHistoryLink(params: { companyId: number; sessionKey: string; messageId?: string }) {
  const url = new URL(window.location.href)
  url.searchParams.set(COMPANY_PARAM, String(params.companyId))
  url.searchParams.set(THREAD_PARAM, params.sessionKey)
  if (params.messageId) url.searchParams.set(MESSAGE_PARAM, params.messageId)
  else url.searchParams.delete(MESSAGE_PARAM)
  return `${url.pathname}${url.search}${url.hash}`
}

function newThreadKey() {
  return crypto.randomUUID()
}

function rememberThread(scope: string, sessionKey: string) {
  try { rememberAssistantSession(window.localStorage, scope, sessionKey) }
  catch { /* The active thread remains usable when local storage is unavailable. */ }
}

export function useAssistantChatHistory(
  readScope: AiChatReadScope,
  enabled: boolean,
  revealChat: () => void,
) {
  const scope = assistantHistoryScope(readScope.actor, readScope.organizationId, readScope.companyId)
  const currentScope = useRef({ scope })
  if (currentScope.current.scope !== scope) currentScope.current = { scope }
  const scopeEpoch = currentScope.current
  const params = useSearchParams()
  const linkedThread = params.get(COMPANY_PARAM) === String(readScope.companyId) ? params.get(THREAD_PARAM) : null
  const linkedMessage = params.get(MESSAGE_PARAM)
  const deepLinkKey = linkedThread && /^[a-zA-Z0-9_-]{1,150}$/.test(linkedThread) ? linkedThread : null
  const anchorMessageId = deepLinkKey && linkedMessage && /^[1-9][0-9]{0,19}$/.test(linkedMessage) ? linkedMessage : undefined
  const [selected, setSelected] = useState<{ scope: string; key: string; saved: boolean } | null>(null)
  const [filters, setFilters] = useState<{ scope: string | null; open: boolean; archived: boolean; search: string; module: string }>({
    scope, open: false, archived: false, search: "", module: "",
  })
  const [debouncedSearch, setDebouncedSearch] = useState<{ scope: string | null; text: string }>({ scope, text: "" })
  const [drafts, setDrafts] = useState<{ scope: string | null; values: Record<string, string> }>({ scope, values: {} })
  const current = filters.scope === scope ? filters : { scope, open: false, archived: false, search: "", module: "" }
  const sessionKey = deepLinkKey ?? (selected?.scope === scope ? selected.key : null)
  const savedThread = selected?.scope === scope && selected.key === sessionKey ? selected.saved : Boolean(deepLinkKey)

  useEffect(() => {
    if (!scope) return
    let key: string
    try { key = scopedAssistantSession(window.localStorage, scope, newThreadKey) }
    catch { key = newThreadKey() }
    setSelected({ scope, key, saved: false })
    setDrafts(previous => previous.scope === scope ? previous : { scope, values: {} })
  }, [scope])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch({ scope, text: current.search.trim() }), 180)
    return () => clearTimeout(timer)
  }, [scope, current.search])

  useEffect(() => {
    if (scope && deepLinkKey) revealChat()
  }, [scope, deepLinkKey, revealChat])

  const updateFilters = useCallback((change: Partial<Omit<typeof filters, "scope">>) => {
    setFilters(previous => ({
      ...(previous.scope === scope ? previous : { scope, open: false, archived: false, search: "", module: "" }),
      ...change,
    }))
  }, [scope])

  const selectThread = useCallback((key: string, messageId?: string, saved = true) => {
    if (!scope || currentScope.current !== scopeEpoch || readScope.companyId == null) return
    setSelected({ scope, key, saved })
    rememberThread(scope, key)
    if (saved) {
      window.history.replaceState(null, "", assistantHistoryLink({ companyId: readScope.companyId, sessionKey: key, messageId }))
    } else {
      const url = new URL(window.location.href)
      for (const name of [COMPANY_PARAM, THREAD_PARAM, MESSAGE_PARAM]) url.searchParams.delete(name)
      if (window.location.href !== url.href) window.history.replaceState(null, "", url)
    }
    updateFilters({ open: false })
  }, [scope, scopeEpoch, readScope.companyId, updateFilters])

  const newChat = useCallback(() => {
    if (!scope || currentScope.current !== scopeEpoch || readScope.companyId == null) return null
    const key = newThreadKey()
    selectThread(key, undefined, false)
    return key
  }, [scope, scopeEpoch, readScope.companyId, selectThread])

  const openMessage = useCallback((key: string, messageId: string) => {
    selectThread(key, messageId)
    revealChat()
  }, [selectThread, revealChat])

  const session = useAiChatSession(readScope, sessionKey, enabled)
  useEffect(() => {
    if (scope && sessionKey && session.data) rememberThread(scope, sessionKey)
  }, [scope, sessionKey, session.data])
  const archived = session.data?.archived === true
  const sessionUnavailable = (savedThread && session.isSuccess && session.data == null) || accessLost(session.error)
  const messages = useAiChatMessages(readScope, sessionKey, enabled && Boolean(session.data) && !sessionUnavailable)
  const unavailable = sessionUnavailable || accessLost(messages.error)
  const anchor = useAiChatMessage(readScope, sessionKey, enabled && session.data && !unavailable ? anchorMessageId : undefined)
  const list = useAiChatSessions(readScope, {
    archived: current.archived,
    module: current.module || undefined,
    search: current.search && debouncedSearch.scope === scope ? debouncedSearch.text : undefined,
  }, enabled && current.open)

  const draftValue = drafts.scope === scope && sessionKey ? drafts.values[sessionKey] ?? "" : ""
  const setDraft = useCallback((next: SetStateAction<string>) => {
    if (!scope || !sessionKey || currentScope.current !== scopeEpoch) return
    setDrafts(previous => {
      const values = previous.scope === scope ? { ...previous.values } : {}
      const value = typeof next === "function" ? next(values[sessionKey] ?? "") : next
      delete values[sessionKey]
      if (value) values[sessionKey] = value
      const oldest = Object.keys(values).slice(0, -MAX_DRAFTS)
      for (const key of oldest) delete values[key]
      return { scope, values }
    })
  }, [scope, scopeEpoch, sessionKey])

  const messageRows = useMemo(() => {
    if (unavailable) return []
    const rows = messages.data?.pages.slice().reverse().flatMap(page => page.data) ?? []
    return !anchor.isError && anchor.data && !rows.some(row => String(row.id) === String(anchor.data?.id))
      ? [anchor.data, ...rows]
      : rows
  }, [messages.data, anchor.data, anchor.isError, unavailable])

  return {
    scope, sessionKey, session, messages, messageRows, list, archived, unavailable, anchorMessageId,
    listUnavailable: accessLost(list.error),
    anchorMissing: Boolean(anchorMessageId && (anchor.isError || (anchor.isSuccess && !anchor.data))),
    filters: current, updateFilters, selectThread, newChat, openMessage,
    draft: { value: draftValue, onChange: setDraft },
  }
}
