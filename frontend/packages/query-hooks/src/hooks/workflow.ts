import { useCallback, useMemo, useRef, useState } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import {
  createSingleFlight,
  createTransitionRunner,
  type CompleteOptions,
  type CompletionPorts,
  type ErpRecordRef,
  type TransitionEvent,
  type TransitionNotice,
  type TransitionSpec,
  type WorkflowResult,
} from "@lumiere/erp-workflows"

import { rqBigIntKey } from "../http"
import { invalidateStdbQueryResources } from "./stdb"

/**
 * Invalidate each declared query resource in every cache namespace a hook may use: the plain
 * `['<resource>', orgKey]` keys and the typed/`stdb` keys (company-scoped Accounting reads).
 */
export function invalidateQueryResources(
  qc: QueryClient,
  organizationId: bigint,
  resources: readonly string[],
): Promise<void> {
  const orgKey = rqBigIntKey(organizationId)
  invalidateStdbQueryResources(qc, organizationId, resources)
  return Promise.all(
    resources.map((resource) => qc.invalidateQueries({ queryKey: [resource, orgKey] })),
  ).then(() => undefined)
}

export interface WorkflowSurfaceCallbacks {
  notify?(notice: TransitionNotice): void
  navigate?(ref: ErpRecordRef): void
  /** Receives the transition log (identifiers and outcomes only, never command input). */
  record?(event: TransitionEvent): void
}

/**
 * Runs transitions through the shared completion path (`createTransitionRunner`) with React Query
 * invalidation as the invalidate port, one in-flight run per key, retry for safe failures, and
 * the transition log.
 */
export function useWorkflowRunner(organizationId: bigint, callbacks: WorkflowSurfaceCallbacks = {}) {
  const qc = useQueryClient()
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks
  const flight = useMemo(() => createSingleFlight(), [])
  const [pendingRuns, setPendingRuns] = useState(0)

  const ports = useMemo<CompletionPorts>(
    () => ({
      invalidate: (resources) => invalidateQueryResources(qc, organizationId, resources),
      notify: (notice) => callbacksRef.current.notify?.(notice),
      navigate: (ref) => callbacksRef.current.navigate?.(ref),
      record: (event) => callbacksRef.current.record?.(event),
    }),
    [qc, organizationId],
  )

  const runner = useMemo(
    () =>
      createTransitionRunner(ports, {
        flight,
        onStart: () => setPendingRuns((n) => n + 1),
        onSettle: () => setPendingRuns((n) => n - 1),
      }),
    [ports, flight],
  )

  const run = useCallback(
    <TInput,>(
      key: string,
      spec: TransitionSpec<TInput>,
      input: TInput,
      options?: CompleteOptions,
    ): Promise<WorkflowResult> => runner.run(key, spec, input, options),
    [runner],
  )

  return { run, isRunning: flight.isRunning, isPending: pendingRuns > 0 }
}
