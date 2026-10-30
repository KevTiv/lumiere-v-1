"use client"

import { createContext } from "react"

export interface NavigationEditorState {
  dirty: boolean
  pending: boolean
}

export const NavigationEditorContext = createContext<{
  register: (read: () => NavigationEditorState) => () => void
  changed: () => void
  /** Run a user-requested context change through the same discard/pending decision. */
  proceed: (action: () => void) => void
} | null>(null)
