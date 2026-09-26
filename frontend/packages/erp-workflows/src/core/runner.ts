import type { WorkflowResult } from "./result"
import {
  completeTransition,
  createSingleFlight,
  type CompleteOptions,
  type CompletionPorts,
  type TransitionSpec,
} from "./transition"

export interface TransitionRunnerHooks {
  /** Share one in-flight registry across runners that are rebuilt when their ports change. */
  flight?: ReturnType<typeof createSingleFlight>
  onStart?(): void
  onSettle?(): void
}

/**
 * Runs transitions through `completeTransition` with one in-flight run per key, and adds what
 * only the runner knows: the run key on every logged event, and a retry for failures that are
 * safe to re-issue.
 */
export function createTransitionRunner(ports: CompletionPorts, hooks: TransitionRunnerHooks = {}) {
  const flight = hooks.flight ?? createSingleFlight()

  function run<TInput>(
    key: string,
    spec: TransitionSpec<TInput>,
    input: TInput,
    options: CompleteOptions = {},
    attempt = 1,
  ): Promise<WorkflowResult> {
    return flight.run(key, () => {
      hooks.onStart?.()
      const runPorts: CompletionPorts = {
        ...ports,
        record: (event) => ports.record?.({ ...event, runKey: key }),
        notify: (notice) =>
          ports.notify?.(
            notice.kind === "error" && notice.error?.retryable
              ? { ...notice, retry: () => run(key, spec, input, options, attempt + 1) }
              : notice,
          ),
      }
      return completeTransition(spec, input, runPorts, { ...options, attempt }).finally(() => hooks.onSettle?.())
    })
  }

  return { run, isRunning: flight.isRunning }
}
