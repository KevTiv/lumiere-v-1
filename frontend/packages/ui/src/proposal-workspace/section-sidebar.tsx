"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Plus, FileText, ChevronDown, ChevronRight, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { SectionStatus } from "@/lib/proposal-workspace-types"
import { SECTION_TEMPLATES } from "@/lib/proposal-workspace-types"
import type { ProposalPresence, ProposalSourceDoc } from "@lumiere/stdb/proposal-row-types"
import { rowBigint, rowNumber, rowString } from "./row-field-utils"

type Section = Record<string, unknown>

const STATUS_BADGE_VARIANT: Record<SectionStatus, "secondary" | "outline" | "default" | "destructive"> = {
  empty: "outline",
  draft: "secondary",
  complete: "default",
  reviewed: "default",
}

function avatarColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash)
  const h = Math.abs(hash) % 360
  return `hsl(${h}, 60%, 50%)`
}

interface SectionSidebarProps {
  sections: Section[]
  sourceDocs: ProposalSourceDoc[]
  activeSectionId: bigint | null
  presenceBySection: Map<string, ProposalPresence[]>
  totalValue: number
  onSelectSection: (id: bigint) => void
  onAddSection: (title: string) => void
  onDeleteSection: (id: bigint) => void
  onAddSourceDoc: () => void
  onDeleteSourceDoc: (id: bigint) => void
}

export function SectionSidebar({
  sections,
  sourceDocs,
  activeSectionId,
  presenceBySection,
  totalValue,
  onSelectSection,
  onAddSection,
  onDeleteSection,
  onAddSourceDoc,
  onDeleteSourceDoc,
}: SectionSidebarProps) {
  const { t } = useTranslation()
  const [showTemplates, setShowTemplates] = useState(false)
  const [showDocs, setShowDocs] = useState(true)

  const getStatusLabel = (status: SectionStatus): string => {
    const map: Record<SectionStatus, string> = {
      empty: t("proposalWorkspace.sectionEditor.statusEmpty"),
      draft: t("proposalWorkspace.sectionEditor.statusDraft"),
      complete: t("proposalWorkspace.sectionEditor.statusComplete"),
      reviewed: t("proposalWorkspace.sectionEditor.statusReviewed"),
    }
    return map[status]
  }

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val)

  return (
    <aside className="flex flex-col h-full overflow-y-auto bg-muted/30">
      {/* Sections header */}
      <div className="px-3 pt-3 pb-1 flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("proposalWorkspace.sectionSidebar.sections")}</span>
        <button
          onClick={() => setShowTemplates((v) => !v)}
          className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title={t("proposalWorkspace.sectionSidebar.addSection")}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Template picker */}
      {showTemplates && (
        <div className="mx-2 mb-2 rounded-md border border-border bg-popover shadow-md z-10">
          <p className="px-3 pt-2 pb-1 text-xs text-muted-foreground font-medium">{t("proposalWorkspace.sectionSidebar.chooseTemplate")}</p>
          <div className="max-h-48 overflow-y-auto">
            {SECTION_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => { onAddSection(t.title); setShowTemplates(false) }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
              >
                {t.title}
              </button>
            ))}
            <div className="border-t border-border">
              <button
                onClick={() => {
                  const title = prompt("Section title:")
                  if (title?.trim()) { onAddSection(title.trim()); setShowTemplates(false) }
                }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors text-muted-foreground"
              >
                {t("proposalWorkspace.sectionSidebar.customSection")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Section list */}
      <ul className="flex-1 px-2 pb-2 space-y-0.5">
        {sections.length === 0 && (
          <li className="px-2 py-4 text-center">
            <p className="text-xs text-muted-foreground">{t("proposalWorkspace.sectionSidebar.noSectionsYet")}</p>
            <button
              onClick={() => setShowTemplates(true)}
              className="mt-1 text-xs text-primary hover:underline"
            >
              {t("proposalWorkspace.sectionSidebar.addFromTemplate")}
            </button>
          </li>
        )}
        {sections.map((section) => {
          const sectionId = rowBigint(section.id)
          const statusRaw = rowString(section.status).toLowerCase()
          const status: SectionStatus =
            statusRaw === "empty" ||
            statusRaw === "draft" ||
            statusRaw === "complete" ||
            statusRaw === "reviewed"
              ? (statusRaw as SectionStatus)
              : "empty"
          const badgeVariant = STATUS_BADGE_VARIANT[status] ?? STATUS_BADGE_VARIANT.empty
          const badgeLabel = getStatusLabel(status)
          const presenceRows = presenceBySection.get(String(sectionId)) ?? []
          const isActive = activeSectionId === sectionId

          return (
            <li key={String(sectionId)}>
              <button
                onClick={() => onSelectSection(sectionId)}
                className={cn(
                  "w-full text-left rounded-md px-2.5 py-2 text-xs transition-colors group relative",
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "hover:bg-muted text-foreground"
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="truncate font-medium leading-tight flex-1">
                    {rowString(section.title) || t("proposalWorkspace.sectionSidebar.untitled")}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Presence avatars */}
                    {presenceRows.slice(0, 2).map((p) => (
                      <div
                        key={String(p.userId)}
                        title={rowString(p.userName)}
                        className="w-4 h-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center shrink-0"
                        style={{ backgroundColor: avatarColor(String(p.userId)) }}
                      >
                        {String(p.userName ?? "?").slice(0, 1).toUpperCase()}
                      </div>
                    ))}
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteSection(sectionId) }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-all"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge variant={badgeVariant} className="text-[10px] px-1 py-0 h-4">
                    {badgeLabel}
                  </Badge>
                  {rowNumber(section.wordCount) > 0 && (
                    <span className="text-[10px] text-muted-foreground">{rowNumber(section.wordCount)}w</span>
                  )}
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      {/* Source documents */}
      <div className="border-t border-border shrink-0">
        <button
          onClick={() => setShowDocs((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:bg-muted transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <FileText className="h-3 w-3" />
            {t("proposalWorkspace.sectionSidebar.sourceDocs", { count: sourceDocs.length })}
          </span>
          {showDocs ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        {showDocs && (
          <div className="px-2 pb-2 space-y-1">
            {sourceDocs.map((doc) => (
              <div key={String(doc.id)} className="flex items-center gap-1.5 group">
                <span className="flex-1 text-xs truncate text-muted-foreground">{rowString(doc.name)}</span>
                <span className="text-[10px] text-muted-foreground">{rowNumber(doc.wordCount)}w</span>
                <button
                  onClick={() => onDeleteSourceDoc(rowBigint(doc.id))}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-destructive transition-all"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="w-full justify-start gap-1.5 text-xs h-7 text-muted-foreground"
              onClick={onAddSourceDoc}
            >
              <Upload className="h-3 w-3" />
              {t("proposalWorkspace.sectionSidebar.addDocument")}
            </Button>
          </div>
        )}
      </div>

      {/* Total value */}
      {totalValue > 0 && (
        <div className="border-t border-border px-3 py-2 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t("proposalWorkspace.sectionSidebar.proposalValue")}</span>
            <span className="text-xs font-semibold text-foreground">{formatCurrency(totalValue)}</span>
          </div>
        </div>
      )}
    </aside>
  )
}
