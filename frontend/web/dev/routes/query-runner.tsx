import { createRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Route as rootRoute } from './__root'

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/query-runner',
  validateSearch: (search: Record<string, unknown>) => ({
    resource: (search.resource as string) ?? '',
    orgId: (search.orgId as string) ?? '',
  }),
  component: QueryRunnerPage,
})

function QueryRunnerPage() {
  const { resource: initialResource, orgId: initialOrgId } = Route.useSearch()
  const navigate = Route.useNavigate()

  const [resource, setResource] = useState(initialResource)
  const [orgId, setOrgId] = useState(initialOrgId)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<Array<{ resource: string; orgId: string; timestamp: number }>>([])

  const run = async () => {
    if (!resource) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const params = new URLSearchParams()
      if (orgId) params.set('organizationId', orgId)
      const response = await fetch(`/api/query/${resource}${params.toString() ? `?${params}` : ''}`)
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`)
      setResult(json)
      const entry = { resource, orgId, timestamp: Date.now() }
      setHistory((prev) => [entry, ...prev.slice(0, 9)])
      navigate({ search: { resource, orgId }, replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const rowCount = Array.isArray(result)
    ? result.length
    : result && typeof result === 'object' && 'data' in (result as object)
    ? ((result as { data: unknown[] }).data?.length ?? 0)
    : null

  return (
    <div className="flex h-full flex-col p-4 gap-4">
      <div>
        <h1 className="text-lg font-semibold mb-1">Query Runner</h1>
        <p className="text-sm text-muted-foreground">Ad-hoc queries against the /api/query/[resource] endpoint</p>
      </div>

      {/* Input row */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-xs font-medium block mb-1">Resource</label>
          <input
            type="text"
            value={resource}
            onChange={(e) => setResource(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            placeholder="e.g., leads, sale-orders, products..."
            className="w-full rounded border px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="w-44">
          <label className="text-xs font-medium block mb-1">Organization ID</label>
          <input
            type="text"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            placeholder="optional"
            className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <button
          onClick={run}
          disabled={loading || !resource}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50 shrink-0"
        >
          {loading ? 'Running...' : 'Run'}
        </button>
      </div>

      {/* Recent history */}
      {history.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {history.map((h, i) => (
            <button
              key={i}
              onClick={() => {
                setResource(h.resource)
                setOrgId(h.orgId)
              }}
              className="rounded bg-muted px-2 py-1 text-xs hover:bg-muted/80 font-mono"
            >
              {h.resource}{h.orgId ? ` (${h.orgId})` : ''}
            </button>
          ))}
        </div>
      )}

      {/* Result */}
      <div className="flex-1 rounded border overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 text-xs">
          <span className="font-medium">Response</span>
          {rowCount !== null && <span className="text-muted-foreground">{rowCount} rows</span>}
        </div>
        <div className="flex-1 overflow-auto p-3">
          {error && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          )}
          {result !== null && !error && (
            <pre className="text-xs font-mono whitespace-pre-wrap">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
          {result === null && !error && !loading && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Enter a resource name and click Run (or press Enter)
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
