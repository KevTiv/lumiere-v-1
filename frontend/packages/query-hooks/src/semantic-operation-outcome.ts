export const SEMANTIC_OPERATION_OUTCOME_EVENT = "lumiere:semantic-operation-outcome"

export interface SemanticOperationOutcomeDetail {
  readonly formId: string
  readonly kind: "converged" | "already-applied"
  readonly resource: string
  readonly recordId: string
  readonly href?: string
  readonly message: string
  readonly actionLabel?: string
  readonly correlationId?: string
}

/**
 * Browser-only bridge from application/query hooks to presentation feedback.
 * Carries only an already-resolved semantic outcome and canonical record ref.
 * It never grants authority and must never be used as a mutation trigger.
 */
export function emitSemanticOperationOutcome(
  detail: SemanticOperationOutcomeDetail,
): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<SemanticOperationOutcomeDetail>(SEMANTIC_OPERATION_OUTCOME_EVENT, {
      detail,
    }),
  )
}
