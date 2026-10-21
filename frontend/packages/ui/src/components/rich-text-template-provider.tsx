"use client"

import * as React from "react"

export type RichTextTemplateOption = {
  id: string
  name: string
  html: string
}

type RichTextTemplateSource = {
  /** Changes when the authenticated organization or selected company changes. */
  scopeKey: string
  /** Only authorized, prose-compatible templates belong in this list. */
  templates: readonly RichTextTemplateOption[]
  status: "idle" | "loading" | "ready" | "error"
  error?: string
  onRequest: () => void
}

export type RichTextTemplateProviderProps = RichTextTemplateSource & {
  /** Hides choices without unmounting the forms inside this provider. */
  enabled?: boolean
  children: React.ReactNode
}

const RichTextTemplateContext =
  React.createContext<RichTextTemplateSource | null>(null)

/** Provides scoped template choices without coupling the editor to data fetching. */
export function RichTextTemplateProvider({
  children,
  enabled = true,
  scopeKey,
  templates,
  status,
  error,
  onRequest
}: RichTextTemplateProviderProps) {
  const source = React.useMemo(
    () => (enabled ? { scopeKey, templates, status, error, onRequest } : null),
    [enabled, scopeKey, templates, status, error, onRequest]
  )

  return (
    <RichTextTemplateContext.Provider value={source}>
      {children}
    </RichTextTemplateContext.Provider>
  )
}

export function useRichTextTemplates() {
  return React.useContext(RichTextTemplateContext)
}
