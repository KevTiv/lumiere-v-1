"use client"

import { GitCommit, RotateCcw, X, Plus, Minus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ProposalVersion, TenderSection, VersionLine } from "@/lib/proposal-workspace-types"

interface VersionDiffModalProps {
  open: boolean
  onClose: () => void
  version: ProposalVersion
  currentSections: TenderSection[]
  onRestore: () => void
}

function computeLineDiff(oldText: string, newText: string): VersionLine[] {
  const oldLines = oldText.split("\n")
  const newLines = newText.split("\n")
  const result: VersionLine[] = []

  // Simple LCS-based line diff
  const m = oldLines.length
  const n = newLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack
  let i = m, j = n
  const ops: VersionLine[] = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: "unchanged", text: oldLines[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: "added", text: newLines[j - 1] })
      j--
    } else {
      ops.push({ type: "removed", text: oldLines[i - 1] })
      i--
    }
  }
  ops.reverse()
  result.push(...ops)
  return result
}

function DiffLineView({ lines }: { lines: VersionLine[] }) {
  return (
    <div className="font-mono text-[11px] leading-relaxed">
      {lines.map((line, idx) => (
        <div
          key={idx}
          className={cn(
            "flex gap-2 px-2 py-0.5",
            line.type === "added" && "bg-green-50 dark:bg-green-900/20",
            line.type === "removed" && "bg-red-50 dark:bg-red-900/20",
          )}
        >
          <span className={cn(
            "w-4 shrink-0 text-center",
            line.type === "added" && "text-green-600",
            line.type === "removed" && "text-red-600",
            line.type === "unchanged" && "text-muted-foreground/40",
          )}>
            {line.type === "added" && "+"}
            {line.type === "removed" && "-"}
            {line.type === "unchanged" && " "}
          </span>
          <span className={cn(
            "flex-1 whitespace-pre-wrap break-words",
            line.type === "added" && "text-green-800 dark:text-green-300",
            line.type === "removed" && "text-red-700 dark:text-red-400 line-through opacity-70",
            line.type === "unchanged" && "text-muted-foreground",
          )}>
            {line.text || " "}
          </span>
        </div>
      ))}
    </div>
  )
}

export function VersionDiffModal({ open, onClose, version, currentSections, onRestore }: VersionDiffModalProps) {
  if (!open) return null

  const totalAdded = version.diff?.totalLinesAdded ?? 0
  const totalRemoved = version.diff?.totalLinesRemoved ?? 0

  // Compute diff between this version's sections and current sections
  const diffSections = version.sections.map((savedSection) => {
    const current = currentSections.find((s) => s.id === savedSection.id)
    const oldContent = savedSection.content
    const newContent = current?.content ?? ""
    const lines = computeLineDiff(oldContent, newContent)
    const hasChanges = lines.some((l) => l.type !== "unchanged")
    return { section: savedSection, lines, hasChanges }
  })

  const changedSections = diffSections.filter((d) => d.hasChanges)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-background rounded-xl border border-border shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <GitCommit className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-foreground">
              v{version.versionNumber} — {version.message || "No description"}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              by {version.author} · {new Date(version.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {totalAdded > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-green-600">
                <Plus className="h-3 w-3" />{totalAdded}
              </span>
            )}
            {totalRemoved > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-red-500">
                <Minus className="h-3 w-3" />{totalRemoved}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Diff content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {changedSections.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No differences — this version matches the current draft.</p>
            </div>
          ) : (
            changedSections.map(({ section, lines }) => (
              <div key={section.id} className="rounded-lg border border-border overflow-hidden">
                <div className="px-3 py-2 bg-muted/40 border-b border-border">
                  <p className="text-xs font-semibold text-foreground">{section.title}</p>
                </div>
                <DiffLineView lines={lines} />
              </div>
            ))
          )}

          {/* Sections added in current but not in this version */}
          {currentSections
            .filter((cs) => !version.sections.find((vs) => vs.id === cs.id))
            .map((cs) => (
              <div key={cs.id} className="rounded-lg border border-green-200 dark:border-green-800 overflow-hidden">
                <div className="px-3 py-2 bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-800">
                  <p className="text-xs font-semibold text-green-700 dark:text-green-400">
                    + New section: {cs.title}
                  </p>
                </div>
                <DiffLineView lines={cs.content.split("\n").map((text) => ({ type: "added" as const, text }))} />
              </div>
            ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border shrink-0">
          <p className="text-xs text-muted-foreground">
            Restoring will replace the current draft with this version.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button size="sm" variant="destructive" onClick={onRestore} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Restore v{version.versionNumber}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
