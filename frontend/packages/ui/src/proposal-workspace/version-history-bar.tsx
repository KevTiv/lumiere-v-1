"use client"

import { useState } from "react"
import { GitCommit, Clock, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ProposalVersion, WorkspaceAction } from "@/lib/proposal-workspace-types"
import { VersionDiffModal } from "./version-diff-modal"

interface VersionHistoryBarProps {
  versions: ProposalVersion[]
  activeVersionId: string | null
  currentSections: import("@/lib/proposal-workspace-types").TenderSection[]
  dispatch: React.Dispatch<WorkspaceAction>
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function VersionHistoryBar({ versions, activeVersionId, currentSections, dispatch }: VersionHistoryBarProps) {
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const expandedVersion = versions.find((v) => v.id === expandedVersionId) ?? null

  return (
    <>
      <div className="border-t border-border bg-muted/20 shrink-0">
        {/* Toggle bar */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-4 py-2 hover:bg-muted/40 transition-colors"
        >
          <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">Version History</span>
          <span className="text-xs text-muted-foreground">
            {versions.length === 0 ? "No saved versions" : `${versions.length} version${versions.length > 1 ? "s" : ""}`}
          </span>
          {versions.length > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">
              {expanded ? "▲" : "▼"}
            </span>
          )}
        </button>

        {/* Version chips strip */}
        {expanded && versions.length > 0 && (
          <div className="px-4 pb-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {[...versions].reverse().map((version) => (
                <button
                  key={version.id}
                  onClick={() => {
                    dispatch({ type: "SET_ACTIVE_VERSION", id: version.id })
                    setExpandedVersionId(version.id)
                  }}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs shrink-0 transition-colors",
                    activeVersionId === version.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-foreground hover:border-primary/50 hover:text-primary"
                  )}
                >
                  <GitCommit className="h-3 w-3" />
                  <span className="font-medium">v{version.versionNumber}</span>
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">{timeAgo(new Date(version.createdAt))}</span>
                  {version.message && (
                    <span className="text-muted-foreground truncate max-w-[80px]">· "{version.message}"</span>
                  )}
                  {version.diff && (
                    <span className="text-green-500 text-[10px]">
                      +{version.diff.totalLinesAdded}
                    </span>
                  )}
                  {version.diff && version.diff.totalLinesRemoved > 0 && (
                    <span className="text-red-500 text-[10px]">
                      -{version.diff.totalLinesRemoved}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Diff modal */}
      {expandedVersion && (
        <VersionDiffModal
          open={expandedVersionId !== null}
          onClose={() => {
            setExpandedVersionId(null)
            dispatch({ type: "SET_ACTIVE_VERSION", id: null })
          }}
          version={expandedVersion}
          currentSections={currentSections}
          onRestore={() => {
            dispatch({ type: "RESTORE_VERSION", versionId: expandedVersion.id })
            setExpandedVersionId(null)
          }}
        />
      )}
    </>
  )
}

interface SaveVersionButtonProps {
  dispatch: React.Dispatch<WorkspaceAction>
  isDirty: boolean
  versionCount: number
}

export function SaveVersionButton({ dispatch, isDirty, versionCount }: SaveVersionButtonProps) {
  const [message, setMessage] = useState("")
  const [showInput, setShowInput] = useState(false)

  const handleSave = () => {
    dispatch({
      type: "SAVE_VERSION",
      message: message.trim() || `Version ${versionCount + 1}`,
      author: "You",
    })
    setMessage("")
    setShowInput(false)
  }

  if (showInput) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setShowInput(false) }}
          placeholder="Describe this version…"
          className="text-xs px-2 py-1 rounded border border-border bg-background outline-none ring-1 ring-primary w-40"
        />
        <button onClick={handleSave} className="text-xs text-primary font-medium hover:underline">
          Save
        </button>
        <button onClick={() => setShowInput(false)} className="text-xs text-muted-foreground hover:text-foreground">
          ✕
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setShowInput(true)}
      disabled={!isDirty}
      className={cn(
        "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border transition-colors",
        isDirty
          ? "border-primary text-primary hover:bg-primary/10"
          : "border-border text-muted-foreground cursor-not-allowed"
      )}
    >
      <RotateCcw className="h-3.5 w-3.5" />
      Save v{versionCount + 1}
    </button>
  )
}
