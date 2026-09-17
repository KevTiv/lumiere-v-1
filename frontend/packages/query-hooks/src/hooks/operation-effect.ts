import {
  OperationRequestError,
  type OperationDispatchReceipt,
} from "@lumiere/api-client"

export interface CanonicalRecordRef {
  readonly resource: string
  readonly id: string
  readonly href?: string
}

export type OperationEffectOutcome<Ref extends CanonicalRecordRef = CanonicalRecordRef> =
  | {
      readonly kind: "applied"
      readonly ref: Ref
      readonly receipt: OperationDispatchReceipt
    }
  | {
      readonly kind: "already-applied"
      readonly ref: Ref
    }
  | {
      readonly kind: "rejected"
      readonly error: OperationRequestError
    }
  | {
      readonly kind: "outcome-unknown"
      readonly reason: "dispatch-unknown" | "readback-missing" | "readback-failed"
      readonly correlationId?: string
      readonly receipt?: OperationDispatchReceipt
    }

export interface ExecuteOperationWithReadbackArgs<Ref extends CanonicalRecordRef> {
  /**
   * Resolve the exact business effect by a stable key (for example
   * sale_order.opportunity_id). Never implement this as "latest row".
   */
  readonly resolveEffect: () => Promise<Ref | null>
  /** Dispatch the generated typed operation. */
  readonly dispatch: () => Promise<OperationDispatchReceipt>
  /** Refresh/invalidate affected read surfaces after dispatch. */
  readonly afterDispatch?: () => void | Promise<void>
  /** Small bounded readback window for STDB/query propagation. */
  readonly readbackAttempts?: number
  readonly readbackDelayMs?: number
  /** Injectable for deterministic tests. */
  readonly wait?: (delayMs: number) => Promise<void>
}

function defaultWait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

/**
 * Reference COV-01 mutation protocol.
 *
 * 1. Resolve the exact effect before dispatch: an idempotent replay returns
 *    AlreadyApplied without creating another effect.
 * 2. Dispatch through the generated operation boundary.
 * 3. Resolve the exact canonical effect after dispatch.
 * 4. If dispatch/readback is ambiguous, return OutcomeUnknown. Never blind-retry.
 */
export async function executeOperationWithCanonicalReadback<
  Ref extends CanonicalRecordRef,
>(
  args: ExecuteOperationWithReadbackArgs<Ref>,
): Promise<OperationEffectOutcome<Ref>> {
  const existing = await args.resolveEffect()
  if (existing) return { kind: "already-applied", ref: existing }

  let receipt: OperationDispatchReceipt
  try {
    receipt = await args.dispatch()
  } catch (error) {
    if (error instanceof OperationRequestError) {
      if (error.retry !== "reconcile") {
        return { kind: "rejected", error }
      }
      return {
        kind: "outcome-unknown",
        reason: "dispatch-unknown",
        correlationId: error.correlationId,
      }
    }

    return {
      kind: "outcome-unknown",
      reason: "dispatch-unknown",
    }
  }

  await args.afterDispatch?.()

  const attempts = Math.max(1, args.readbackAttempts ?? 3)
  const delayMs = Math.max(0, args.readbackDelayMs ?? 100)
  const wait = args.wait ?? defaultWait

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const ref = await args.resolveEffect()
      if (ref) return { kind: "applied", ref, receipt }
    } catch {
      if (attempt === attempts - 1) {
        return {
          kind: "outcome-unknown",
          reason: "readback-failed",
          correlationId: receipt.correlationId,
          receipt,
        }
      }
    }

    if (attempt < attempts - 1 && delayMs > 0) await wait(delayMs)
  }

  return {
    kind: "outcome-unknown",
    reason: "readback-missing",
    correlationId: receipt.correlationId,
    receipt,
  }
}
