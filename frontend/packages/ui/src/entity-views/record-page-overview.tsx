"use client"

import type { ReactNode } from "react"
import { History } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import {
  presentableActions,
  type AnyWorkflowAction,
} from "@lumiere/erp-workflows"

import { Button } from "../components/button"

export interface RecordResponsibility {
  label: string
  name: string
}

export interface RecordNextStep {
  id: string
  label: string
  blockedReason?: string
}

export function recordWorkflowNextSteps<TRecord>(
  actions: ReadonlyArray<AnyWorkflowAction<TRecord>>,
  record: TRecord,
  primaryActionIds: ReadonlySet<string>,
): RecordNextStep[] {
  return presentableActions(actions, record)
    .filter((action) => primaryActionIds.has(action.id))
    .map((action) => ({
      id: action.id,
      label: action.label,
      blockedReason: action.blockedReason?.(record),
    }))
}

interface RecordPageOverviewProps {
  header?: ReactNode
  responsibility?: RecordResponsibility
  guidance?: ReactNode
  nextSteps?: ReadonlyArray<RecordNextStep>
  smartButtons?: ReactNode
  evidence?: { label: string; open: () => void }
  testIdPrefix: string
}

export function RecordPageOverview({
  header,
  responsibility,
  guidance,
  nextSteps,
  smartButtons,
  evidence,
  testIdPrefix,
}: RecordPageOverviewProps) {
  const { t } = useTranslation()
  if (
    !header &&
    !responsibility &&
    !guidance &&
    !nextSteps?.length &&
    !smartButtons &&
    !evidence
  ) {
    return null
  }

  return (
    <section
      aria-label={t("recordOverview.title", {
        defaultValue: "Record overview",
      })}
      className="min-w-0 space-y-4"
      data-testid={`${testIdPrefix}-record-overview`}
    >
      {header}
      {responsibility ? (
        <dl className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
          <dt className="text-muted-foreground">{responsibility.label}</dt>
          <dd className="min-w-0 font-medium [overflow-wrap:anywhere]">
            {responsibility.name}
          </dd>
        </dl>
      ) : null}
      {guidance ??
        (nextSteps?.length ? (
          <div className="max-w-prose space-y-1 rounded-lg border border-border px-4 py-3 text-sm">
            <h2 className="font-medium">
              {t("recordOverview.nextStep", {
                count: nextSteps.length,
                defaultValue_one: "Next step",
                defaultValue_other: "Next steps",
              })}
            </h2>
            <ul className="space-y-1">
              {nextSteps.map((step) => (
                <li key={step.id} className="min-w-0 [overflow-wrap:anywhere]">
                  <span>{step.label}</span>
                  {step.blockedReason ? (
                    <p className="text-muted-foreground">
                      {step.blockedReason}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null)}
      {smartButtons || evidence ? (
        <div className="flex flex-wrap items-center gap-2">
          {smartButtons ? (
            <div
              role="group"
              aria-label={t("recordOverview.relatedRecords", {
                defaultValue: "Related records",
              })}
              className="min-w-0 empty:hidden"
            >
              {smartButtons}
            </div>
          ) : null}
          {evidence ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto min-h-8 max-w-full whitespace-normal py-1 text-left"
              onClick={evidence.open}
              data-testid={`${testIdPrefix}-open-evidence`}
            >
              <History aria-hidden="true" />
              {evidence.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
