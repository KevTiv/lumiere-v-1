"use client"

import { createContext, useContext } from "react"
import type { WorkspaceProfile } from "./workspace-profile"

const WorkspaceProfileContext = createContext<WorkspaceProfile>("full")
export const WorkspaceProfileProvider = WorkspaceProfileContext.Provider
export const useWorkspaceProfile = () => useContext(WorkspaceProfileContext)
