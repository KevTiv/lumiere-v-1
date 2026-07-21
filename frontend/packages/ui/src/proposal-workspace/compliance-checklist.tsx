"use client"

import { useTranslation } from "@lumiere/i18n"
import { CheckCircle2, Circle, Ban } from "lucide-react"
import { cn } from "@/lib/utils"
import { rowBool, rowNumber, rowString } from "./row-field-utils"

type ComplianceRow = Record<string, unknown>

interface ComplianceChecklistProps {
  rows: ComplianceRow[]
  proposalId: bigint
  onToggleComplete: (row: ComplianceRow, complete: boolean) => void
}

function ComplianceStatusIcon({
  waived,
  complete,
}: {
  waived: boolean
  complete: boolean
}) {
  if (waived) {
    return <Ban className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
  }
  if (complete) {
    return <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
  }
  return <Circle className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
}

export function ComplianceChecklist({
  rows,
  proposalId,
  onToggleComplete,
}: ComplianceChecklistProps) {
  const { t } = useTranslation()
  const proposalIdStr = String(proposalId)
  const scoped = rows
    .filter((r) => rowString(r.proposalId ?? r.proposal_id) === proposalIdStr)
    .sort((a, b) => rowNumber(a.sequence) - rowNumber(b.sequence))

  if (scoped.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        {t("proposalWorkspace.compliance.empty", {
          defaultValue: "No compliance requirements yet — run Analyze to materialize.",
        })}
      </div>
    )
  }

  const incompleteCount = scoped.filter(
    (r) => rowBool(r.isRequired, true) && !rowBool(r.isComplete) && !rowBool(r.isWaived),
  ).length

  return (
    <div className="border-t border-border">
      <div className="px-3 pt-3 pb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {t("proposalWorkspace.compliance.title", { defaultValue: "Compliance" })}
        </span>
        {incompleteCount > 0 && (
          <span className="text-[10px] text-destructive font-medium">
            {incompleteCount} open
          </span>
        )}
      </div>
      <ul className="px-2 pb-2 space-y-0.5">
        {scoped.map((row) => {
          const complete = rowBool(row.isComplete)
          const waived = rowBool(row.isWaived)
          const required = rowBool(row.isRequired, true)
          return (
            <li key={String(row.id)}>
              <button
                type="button"
                disabled={waived}
                onClick={() => onToggleComplete(row, !complete)}
                className={cn(
                  "w-full flex items-start gap-2 rounded px-1.5 py-1.5 text-left text-xs hover:bg-muted/60 transition-colors",
                  waived && "opacity-60 cursor-default",
                )}
              >
                <ComplianceStatusIcon waived={waived} complete={complete} />
                <span className="min-w-0">
                  <span className="font-medium text-foreground leading-snug block truncate">
                    {rowString(row.title)}
                  </span>
                  {required && !complete && !waived && (
                    <span className="text-[10px] text-muted-foreground">Required</span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
