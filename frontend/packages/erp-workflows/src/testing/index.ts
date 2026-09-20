import type { CompletionPorts, TransitionNotice } from "../core/transition"
import type { ErpRecordRef } from "../core/record-ref"

/** Recording ports for asserting invalidation, notification and navigation without a browser. */
export function createFakeCompletionPorts(options?: { failInvalidate?: boolean }) {
  const invalidated: string[][] = []
  const notices: TransitionNotice[] = []
  const navigated: ErpRecordRef[] = []
  const ports: CompletionPorts = {
    async invalidate(resources) {
      invalidated.push([...resources])
      if (options?.failInvalidate) throw new Error("invalidate failed")
    },
    notify: (notice) => void notices.push(notice),
    navigate: (ref) => void navigated.push(ref),
  }
  return { ports, invalidated, notices, navigated }
}
