"use client"

import { createContext } from "react"

export interface NavigationEditorState {
  dirty: boolean
  pending: boolean
}

export const NavigationEditorContext = createContext<{
  register: (read: () => NavigationEditorState) => () => void
  changed: () => void
} | null>(null)
