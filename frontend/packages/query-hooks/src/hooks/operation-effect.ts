import {
  OperationRequestError,
  type OperationDispatchReceipt,
} from "@lumiere/api-client"

export interface CanonicalRecordRef {
  readonly resource: string
  readonly id: string
  readonly href?: string
}

export class AmbiguousOperationEffectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AmbiguousOperationEffectError"
  }
}

/**
 * Resolve zero-or-one effect from an exact business key. More than one match is
 * an invariant failure; callers must never hide it by choosing the newest row.
 */
export function resolveUniqueEffect<Row, Ref extends CanonicalRecordRef>(
  rows: readonly Row[],
  matches: (row: Row) => boolean,
  toRef: (row: Row) => Ref,
): Ref | null {
  const matched = rows.filter(matches)
  if (matched.length === 0) return null
  if (matched.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one canonical effect, found ${matched.length}`,
    )
  }
  return toRef(matched[0]!)
}

export type OperationEffectWarning = "refresh-failed"

export type OperationEffectOutcome<Ref extends CanonicalRecordRef = CanonicalRecordRef> =
  | {
      readonly kind: "applied"
      readonly ref: Ref
      readonly receipt?: OperationDispatchReceipt
      readonly correlationId?: string
      readonly warnings?: readonly OperationEffectWarning[]
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
      readonly warnings?: readonly OperationEffectWarning[]
    }

export interface ExecuteOperationWithReadbackArgs<Ref extends CanonicalRecordRef> {
  /**
   * Resolve the exact business effect by a stable key (for example
   * sale_order.opportunity_id). Never implement this as "latest row".
   * This must bypass stale UI cache when used for correctness.
   */
  readonly resolveEffect: () => Promise<Ref | null>
  /** Dispatch the generated typed operation once. */
  readonly dispatch: () => Promise<OperationDispatchReceipt>
  /** Refresh/invalidate affected UI read surfaces after effect resolution. */
  readonly afterDispatch?: () => void | Promise<void>
  /** Small bounded exact-readback window for STDB/query projection propagation. */
  readonly readbackAttempts?: number
  readonly readbackDelayMs?: number
  /** Injectable for deterministic tests. */
  readonly wait?: (delayMs: number) => Promise<void>
}

function defaultWait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function attachRefreshWarning<Ref extends CanonicalRecordRef>(
  outcome:
    | Extract<OperationEffectOutcome<Ref>, { kind: "applied" }>
    | Extract<OperationEffectOutcome<Ref>, { kind: "outcome-unknown" }>,
  afterDispatch?: () => void | Promise<void>,
): Promise<typeof outcome> {
  if (!afterDispatch) return outcome

  try {
    await afterDispatch()
    return outcome
  } catch {
    return { ...outcome, warnings: ["refresh-failed"] }
  }
}

/**
 * Reference COV-01 mutation protocol.
 *
 * 1. Resolve the exact effect before dispatch: an idempotent replay returns
 *    AlreadyApplied without creating another effect.
 * 2. Dispatch through the generated operation boundary exactly once.
 * 3. Whether dispatch is acknowledged or ambiguous, reconcile through the same
 *    cache-independent exact readback. Never redispatch to discover the answer.
 * 4. An observed exact effect is Applied even when the HTTP response was lost;
 *    the result records the available correlation/receipt evidence.
 * 5. If exact readback remains unresolved, return OutcomeUnknown.
 * 6. Multiple exact effects are a hard invariant failure, not a selection problem.
 * 7. Cache refresh happens after effect resolution and cannot rewrite effect certainty.
 */
export async function executeOperationWithCanonicalReadback<
  Ref extends CanonicalRecordRef,
>(
  args: ExecuteOperationWithReadbackArgs<Ref>,
): Promise<OperationEffectOutcome<Ref>> {
  const existing = await args.resolveEffect()
  if (existing) return { kind: "already-applied", ref: existing }

  let receipt: OperationDispatchReceipt | undefined
  let dispatchCorrelationId: string | undefined
  let dispatchWasAmbiguous = false

  try {
    receipt = await args.dispatch()
    dispatchCorrelationId = receipt.correlationId
  } catch (error) {
    if (error instanceof OperationRequestError && error.retry !== "reconcile") {
      return { kind: "rejected", error }
    }

    dispatchWasAmbiguous = true
    if (error instanceof OperationRequestError) {
      dispatchCorrelationId = error.correlationId
    }
  }

  const attempts = Math.max(1, args.readbackAttempts ?? 3)
  const delayMs = Math.max(0, args.readbackDelayMs ?? 100)
  const wait = args.wait ?? defaultWait

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const ref = await args.resolveEffect()
      if (ref) {
        return attachRefreshWarning(
          {
            kind: "applied",
            ref,
            receipt,
            correlationId: dispatchCorrelationId,
          },
          args.afterDispatch,
        )
      }
    } catch (error) {
      if (error instanceof AmbiguousOperationEffectError) throw error
      if (attempt === attempts - 1) {
        return attachRefreshWarning(
          {
            kind: "outcome-unknown",
            reason: "readback-failed",
            correlationId: dispatchCorrelationId,
            receipt,
          },
          args.afterDispatch,
        )
      }
    }

    if (attempt < attempts - 1 && delayMs > 0) await wait(delayMs)
  }

  return attachRefreshWarning(
    {
      kind: "outcome-unknown",
      reason: dispatchWasAmbiguous ? "dispatch-unknown" : "readback-missing",
      correlationId: dispatchCorrelationId,
      receipt,
    },
    args.afterDispatch,
  )
}
