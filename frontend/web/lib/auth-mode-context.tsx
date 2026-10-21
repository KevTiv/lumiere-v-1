"use client"
import { createContext, useContext } from 'react'
export const AuthModeContext = createContext(false)
export function useWorkOsAuthMode() { return useContext(AuthModeContext) }

export function AuthModeProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <AuthModeContext.Provider value={enabled}>{children}</AuthModeContext.Provider>
}
