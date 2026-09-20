import { toWorkflowError, type WorkflowError, type WorkflowErrorKind } from "./errors"
import type { ErpRecordRef } from "./record-ref"
import type { WorkflowOutcome, WorkflowResult } from "./result"

/** What the canonical readback found after a command was accepted. */
export interface ObservedTransition {
  outcome?: WorkflowOutcome
  createdRecords?: ErpRecordRef[]
  next?: ErpRecordRef
}

/**
 * One command's contract with the rest of the app. The command is a generated operation; this
 * only declares what it touches and how to find what it produced.
 */
export interface TransitionSpec<TInput> {
  id: string
  /** Executes the generated command. Throw a `WorkflowError`, or anything `toWorkflowError` accepts. */
  command(input: TInput): Promise<void>
  /** Query resources this transition invalidates on completion (explicit, never inferred). */
  affects: readonly string[]
  /** True when re-issuing the command cannot duplicate its effect. */
  idempotent?: boolean
  /** Read canonical state after invalidation to resolve outcome and created/next records. */
  observe?(input: TInput): Promise<ObservedTransition>
}

export interface TransitionNotice {
  kind: "success" | "info" | "error"
  transitionId: string
  /** Identifies this run in the transition log; a retry gets a new one. */
  correlationId: string
  /** 1 for the first run, incremented on each retry. */
  attempt: number
  result?: WorkflowResult
  error?: WorkflowError
  /** The affected lists were refetched because the failure left the view out of date. */
  refreshed?: boolean
  /**
   * Re-runs the same transition. Present only when re-issuing cannot duplicate the write
   * (`retryable_transport`); an unknown outcome is never offered a retry.
   */
  retry?: () => Promise<WorkflowResult>
}

/**
 * One line of the transition log. It carries identifiers and outcomes only, never the command's
 * input, so it is safe to ship to an analytics/logging sink.
 */
export interface TransitionEvent {
  correlationId: string
  transitionId: string
  /** The in-flight key of the run (`<transition>:<record id>`), set by the runner. */
  runKey?: string
  attempt: number
  status: "applied" | "approval_pending" | "failed"
  errorKind?: WorkflowErrorKind
  httpStatus?: number
  refreshed?: boolean
  durationMs: number
  affectedResources: readonly string[]
  createdRecords?: ReadonlyArray<{ resource: string; id: string }>
}

/** Side effects a surface supplies; the completion path itself stays framework-free. */
export interface CompletionPorts {
  invalidate(resources: readonly string[]): Promise<void>
  notify?(notice: TransitionNotice): void
  /** Receives one event per run. A failing sink never affects the transition. */
  record?(event: TransitionEvent): void
  /** Called with the record to open after success. Surfaces that do not navigate omit it. */
  navigate?(ref: ErpRecordRef): void
}

export interface CompleteOptions {
  /** Open `result.next` after success. */
  navigateToNext?: boolean
  /** 1 for the first run; the runner increments it on a retry. */
  attempt?: number
}

let idCounter = 0

/** Unique per run; uses the platform UUID when present and a monotonic fallback otherwise. */
export function newCorrelationId(): string {
  const uuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.()
  return uuid ?? `wf-${Date.now().toString(36)}-${(idCounter++).toString(36)}`
}

/**
 * The single post-command path:
 * execute → normalize error → invalidate → observe canonical state → resolve refs → notify/navigate.
 */
export async function completeTransition<TInput>(
  spec: TransitionSpec<TInput>,
  input: TInput,
  ports: CompletionPorts,
  options: CompleteOptions = {},
): Promise<WorkflowResult> {
  const correlationId = newCorrelationId()
  const attempt = options.attempt ?? 1
  const startedAt = Date.now()
  const record = (event: Omit<TransitionEvent, "correlationId" | "transitionId" | "attempt" | "durationMs">) => {
    try {
      ports.record?.({
        correlationId,
        transitionId: spec.id,
        attempt,
        durationMs: Date.now() - startedAt,
        ...event,
      })
    } catch {
      // Observability must never turn a finished transition into a failure.
    }
  }

  try {
    await spec.command(input)
  } catch (raw) {
    const error = toWorkflowError(raw, { idempotent: spec.idempotent })
    let refreshed = false
    if (error.needsRefresh) {
      // A write that may have landed, or a view someone else made stale: converge on canonical
      // state even though we report failure.
      refreshed = await ports.invalidate(spec.affects).then(
        () => true,
        () => false,
      )
    }
    record({
      status: "failed",
      errorKind: error.kind,
      httpStatus: error.status,
      refreshed,
      affectedResources: spec.affects,
    })
    ports.notify?.({ kind: "error", transitionId: spec.id, correlationId, attempt, error, refreshed })
    throw error
  }

  const affectedResources = [...spec.affects]
  await ports.invalidate(affectedResources)

  let observed: ObservedTransition = {}
  try {
    observed = (await spec.observe?.(input)) ?? {}
  } catch {
    // The command succeeded; a failed readback must not turn success into failure.
  }

  const result: WorkflowResult = {
    outcome: observed.outcome ?? "applied",
    affectedResources,
    createdRecords: observed.createdRecords,
    next: observed.next,
  }
  record({
    status: result.outcome,
    affectedResources,
    createdRecords: result.createdRecords?.map(({ resource, id }) => ({ resource, id })),
  })
  ports.notify?.({
    kind: result.outcome === "approval_pending" ? "info" : "success",
    transitionId: spec.id,
    correlationId,
    attempt,
    result,
  })
  if (options.navigateToNext && result.next) ports.navigate?.(result.next)
  return result
}

/**
 * Collapses concurrent runs of the same key into one in-flight promise so a double click or a
 * re-render cannot issue an ambiguous duplicate write.
 */
export function createSingleFlight() {
  const inFlight = new Map<string, Promise<unknown>>()
  return {
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key) as Promise<T> | undefined
      if (existing) return existing
      const promise = fn().finally(() => inFlight.delete(key))
      inFlight.set(key, promise)
      return promise
    },
    isRunning(key: string): boolean {
      return inFlight.has(key)
    },
  }
}
