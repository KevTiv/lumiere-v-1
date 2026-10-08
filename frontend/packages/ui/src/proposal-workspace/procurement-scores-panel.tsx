"use client"

import { useTranslation } from "@lumiere/i18n"
import { Button } from "@/components/ui/button"
import type { ProcurementScoreView } from "./procurement-score"

interface ProcurementScoresPanelProps {
  scores: ProcurementScoreView[]
  /** Shows the add / edit actions; the caller passes the user's `proposal:write` permission. */
  canEdit: boolean
  disabled?: boolean
  onAdd: () => void
  onEdit: (score: ProcurementScoreView) => void
}

export function ProcurementScoresPanel({ scores, canEdit, disabled, onAdd, onEdit }: ProcurementScoresPanelProps) {
  const { t } = useTranslation()
  if (scores.length === 0 && !canEdit) return null
  return (
    <div className="border-t border-border" data-testid="procurement-scores-panel">
      <div className="px-3 pt-3 pb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {t("proposalWorkspace.procurementScores.title", { defaultValue: "Procurement scores" })}
        </span>
        {canEdit ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={disabled}
            data-testid="procurement-score-add"
            onClick={onAdd}
          >
            {t("proposalWorkspace.procurementScores.add", { defaultValue: "Add score" })}
          </Button>
        ) : null}
      </div>
      {scores.length === 0 ? (
        <div className="px-3 pb-2 text-xs text-muted-foreground">
          {t("proposalWorkspace.procurementScores.empty", { defaultValue: "No procurement scores yet." })}
        </div>
      ) : (
        <ul className="px-3 pb-2 space-y-1.5">
          {scores.map((score) => (
            <li
              key={`${score.countryPackKey}:${score.scoreKind}`}
              className="flex items-start justify-between gap-2 text-xs"
              data-testid="procurement-score-row"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {score.scoreKind} <span className="text-muted-foreground">({score.countryPackKey})</span>
                </div>
                {score.notes ? <div className="text-muted-foreground truncate">{score.notes}</div> : null}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="font-semibold">
                  {score.scoreValue} / {score.maxValue}
                </span>
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[10px]"
                    disabled={disabled}
                    onClick={() => onEdit(score)}
                  >
                    {t("proposalWorkspace.procurementScores.edit", { defaultValue: "Edit" })}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
