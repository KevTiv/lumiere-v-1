export type DeferredIndexingPath = 'activity' | 'document'

const DEFERRED_INDEXING_ERRORS = {
  activity:
    'Activity indexing is deferred until an authorized indexing projection is available',
  document:
    'Document indexing is deferred until the authoritative bucket/FileVersion lifecycle is available',
} as const satisfies Record<DeferredIndexingPath, string>

export function deferredIndexingResponse(path: DeferredIndexingPath) {
  return {
    body: { error: DEFERRED_INDEXING_ERRORS[path] },
    status: 503 as const,
  }
}
