import type { SemanticOperationOutcomeDetail } from "@lumiere/query-hooks/semantic-operation-outcome"

import { showWorkflowToast, type WorkflowToastNotice } from "./workflow-toast"

export type SemanticOutcomeNavigator = (href: string) => void

/**
 * Adapt one resolved operation effect to the shared workflow presentation.
 * Domain hooks continue to own the message, action label, and canonical ref.
 */
export function semanticOperationOutcomeNotice(
  detail: SemanticOperationOutcomeDetail,
  navigate: SemanticOutcomeNavigator,
): WorkflowToastNotice {
  const href = detail.href
  const action =
    href && detail.actionLabel
      ? {
          label: detail.actionLabel,
          onClick: () => navigate(href),
        }
      : undefined

  return {
    kind: "success",
    title: detail.message,
    ...(action ? { action } : {}),
  }
}

/** Show a resolved semantic outcome without treating transport acceptance as success. */
export function showSemanticOperationOutcome(
  detail: SemanticOperationOutcomeDetail,
): void {
  showWorkflowToast(
    semanticOperationOutcomeNotice(detail, (href) => window.location.assign(href)),
  )
}
