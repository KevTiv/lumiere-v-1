"use client"

import { createContext } from "react"

export interface NavigationEditorState {
  dirty: boolean
  pending: boolean
}

export const NavigationEditorContext = createContext<{
  register: (read: () => NavigationEditorState) => () => void
  changed: () => void
  /** Run a requested context change or report that the navigation did not proceed. */
  proceed: (action: () => void, onDeclined?: () => void) => void
} | null>(null)
