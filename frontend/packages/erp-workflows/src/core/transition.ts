import { toWorkflowError, WorkflowError } from "./errors"
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
  result?: WorkflowResult
  error?: WorkflowError
}

/** Side effects a surface supplies; the completion path itself stays framework-free. */
export interface CompletionPorts {
  invalidate(resources: readonly string[]): Promise<void>
  notify?(notice: TransitionNotice): void
  /** Called with the record to open after success. Surfaces that do not navigate omit it. */
  navigate?(ref: ErpRecordRef): void
}

export interface CompleteOptions {
  /** Open `result.next` after success. */
  navigateToNext?: boolean
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
  try {
    await spec.command(input)
  } catch (raw) {
    const error = toWorkflowError(raw, { idempotent: spec.idempotent })
    if (error.needsReadback) {
      // The write may have landed: converge on canonical state even though we report failure.
      await ports.invalidate(spec.affects).catch(() => undefined)
    }
    ports.notify?.({ kind: "error", transitionId: spec.id, error })
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
  ports.notify?.({
    kind: result.outcome === "approval_pending" ? "info" : "success",
    transitionId: spec.id,
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
