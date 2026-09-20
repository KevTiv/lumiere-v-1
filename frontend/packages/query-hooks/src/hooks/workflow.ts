import { useCallback, useMemo, useRef, useState } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import {
  completeTransition,
  createSingleFlight,
  type CompleteOptions,
  type CompletionPorts,
  type ErpRecordRef,
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
}

/**
 * Runs transitions through the shared completion path (`completeTransition`) with React Query
 * invalidation as the invalidate port and one in-flight run per key.
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
    }),
    [qc, organizationId],
  )

  const run = useCallback(
    <TInput,>(
      key: string,
      spec: TransitionSpec<TInput>,
      input: TInput,
      options?: CompleteOptions,
    ): Promise<WorkflowResult> =>
      flight.run(key, () => {
        setPendingRuns((n) => n + 1)
        return completeTransition(spec, input, ports, options).finally(() =>
          setPendingRuns((n) => n - 1),
        )
      }),
    [flight, ports],
  )

  return { run, isRunning: flight.isRunning, isPending: pendingRuns > 0 }
}
