"use client"

import { Button } from "@lumiere/ui/components/button"
import { useTranslation } from "@lumiere/i18n"
import type { EntityRow } from "@lumiere/ui/lib/entity-view-types"
import {
  crmWorkflowActions,
  type CrmActionContext,
  type CrmActionId,
  type CrmRecordKind,
} from "./crm-workflow"

interface Props {
  kind: CrmRecordKind
  record: EntityRow
  context: CrmActionContext
  onAction: (action: CrmActionId, record: EntityRow) => void | Promise<void>
}

export function CrmRecordActions({ kind, record, context, onAction }: Props) {
  const { t } = useTranslation()
  const actions = crmWorkflowActions(kind, record, context)
  const reasons = [...new Set(actions.flatMap((action) => (action.reason ? [action.reason] : [])))]
  return (
    <section
      className="w-full space-y-3 rounded-lg border bg-muted/20 p-3"
      aria-label={t("crm.workflow.nextActions")}
    >
      <p className="text-xs font-medium text-muted-foreground">{t("crm.workflow.nextActions")}</p>
      {kind === "opportunity" && (
        <p className="text-sm font-medium">
          {t("crm.workflow.stage", { stage: String(record.stageName ?? "—") })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map(({ id, reason }, index) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={id === "lost" ? "destructive" : index === 0 ? "default" : "outline"}
            disabled={!!reason}
            aria-describedby={reason ? `crm-${kind}-${record.id}-${reason}` : undefined}
            onClick={() => void onAction(id, record)}
          >
            {t(`crm.workflow.actions.${id}`)}
          </Button>
        ))}
      </div>
      {reasons.map((reason) => (
        <p
          key={reason}
          id={`crm-${kind}-${record.id}-${reason}`}
          className="text-xs text-muted-foreground"
        >
          {t(`crm.workflow.reasons.${reason}`)}
        </p>
      ))}
      {reasons.some((reason) =>
        ["stagesRequired", "wonStageRequired", "lostReasonRequired"].includes(reason),
      ) && (
        <a className="text-sm text-primary underline" href="/crm?tab=pipeline-admin">
          {t("crm.forms.openPipelineSetup")}
        </a>
      )}
    </section>
  )
}
