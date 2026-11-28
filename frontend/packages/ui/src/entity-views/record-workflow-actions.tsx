"use client"

import { presentableActions, type AnyWorkflowAction } from "@lumiere/erp-workflows"

import { Button } from "../components/button"
import { BlockerPopover } from "../components/contextual-help"

export interface RecordWorkflowActionsProps<TRecord> {
  actions: ReadonlyArray<AnyWorkflowAction<TRecord>>
  record: TRecord
  /** Runs an action for this record; the surface owns confirmation/forms for non-immediate kinds. */
  onRun: (action: AnyWorkflowAction<TRecord>, record: TRecord) => void
  pendingActionIds?: ReadonlySet<string>
  /** Actions shown as the record's main next step; the rest are outlined. */
  primaryActionIds?: ReadonlySet<string>
  className?: string
}

/**
 * Actions valid for a record's current state, for record sheets and detail workspaces. Actions
 * that are relevant but blocked stay visible, disabled, with an accessible BlockerPopover explaining why.
 */
export function RecordWorkflowActions<TRecord>({
  actions,
  record,
  onRun,
  pendingActionIds,
  primaryActionIds,
  className,
}: RecordWorkflowActionsProps<TRecord>) {
  const presentable = presentableActions(actions, record)
  if (presentable.length === 0) return null
  return (
    <div className={className ?? "flex flex-wrap items-center gap-2"} data-testid="record-workflow-actions">
      {presentable.map((action) => {
        const blocked = action.blockedReason?.(record)
        const button = (
          <Button
            key={action.id}
            size="sm"
            variant={
              action.kind === "destructive"
                ? "destructive"
                : primaryActionIds?.has(action.id)
                  ? "default"
                  : "outline"
            }
            disabled={blocked != null || pendingActionIds?.has(action.id)}
            onClick={() => onRun(action, record)}
            data-testid={`record-workflow-action-${action.id}`}
          >
            {action.label}
          </Button>
        )

        if (blocked != null) {
          return (
            <BlockerPopover
              key={action.id}
              title={`${action.label} unavailable`}
              reason={blocked}
            >
              {button}
            </BlockerPopover>
          )
        }

        return button
      })}
    </div>
  )
}
