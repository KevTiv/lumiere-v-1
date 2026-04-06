import { apiFetch } from '@/lib/api-fetch'
import { createRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { Route as rootRoute } from './__root'

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/log-viewer',
  validateSearch: (search: Record<string, unknown>) => ({
    module: (search.module as string) ?? '',
    tail: Number(search.tail ?? 50),
  }),
  component: LogViewerPage,
})

function LogViewerPage() {
  const { module: initialModule, tail: initialTail } = Route.useSearch()
  const navigate = Route.useNavigate()

  const [module, setModule] = useState(initialModule || '')
  const [tail, setTail] = useState(initialTail || 50)
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  const fetchLogs = async (mod = module, lines = tail) => {
    if (!mod) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ module: mod, tail: String(lines) })
      const res = await apiFetch(`/api/dev/logs?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      const json = await res.json()
      setLogs(json.lines ?? [])
      navigate({ search: { module: mod, tail: lines }, replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh || !module) return
    const interval = setInterval(() => fetchLogs(), 3000)
    return () => clearInterval(interval)
  }, [autoRefresh, module, tail])

  const getLineColor = (line: string) => {
    if (line.includes('ERROR') || line.includes('error') || line.includes('FAILED')) return 'text-red-500'
    if (line.includes('WARN') || line.includes('warn')) return 'text-yellow-500'
    if (line.includes('INFO') || line.includes('info')) return 'text-blue-400'
    return 'text-green-400'
  }

  return (
    <div className="flex h-full flex-col p-4 gap-4">
      <div>
        <h1 className="text-lg font-semibold mb-1">Log Viewer</h1>
        <p className="text-sm text-muted-foreground">Tail logs from your SpacetimeDB module via <code className="text-xs bg-muted px-1 rounded">spacetime logs</code></p>
      </div>

      {/* Controls */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-xs font-medium block mb-1">Module Name</label>
          <input
            type="text"
            value={module}
            onChange={(e) => setModule(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchLogs()}
            placeholder="e.g., lumiere-dev"
            className="w-full rounded border px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="w-28">
          <label className="text-xs font-medium block mb-1">Lines</label>
          <select
            value={tail}
            onChange={(e) => setTail(Number(e.target.value))}
            className="w-full rounded border px-2 py-2 text-sm focus:outline-none"
          >
            {[25, 50, 100, 200, 500].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => fetchLogs()}
          disabled={loading || !module}
          className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Fetch'}
        </button>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="rounded"
          />
          Auto (3s)
        </label>
        {logs.length > 0 && (
          <button
            onClick={() => setLogs([])}
            className="rounded border px-3 py-2 text-sm hover:bg-muted"
          >
            Clear
          </button>
        )}
      </div>

      {/* Log output */}
      <div className="flex-1 rounded border bg-gray-950 overflow-auto font-mono text-xs">
        {error && (
          <div className="p-3 text-red-400">{error}</div>
        )}
        {!error && logs.length === 0 && !loading && (
          <div className="flex items-center justify-center h-full text-gray-600">
            {module ? 'No logs yet — click Fetch' : 'Enter a module name and click Fetch'}
          </div>
        )}
        {loading && logs.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-600">Loading...</div>
        )}
        <div className="p-3 space-y-0.5">
          {logs.map((line, i) => (
            <div key={i} className={`${getLineColor(line)} leading-relaxed`}>
              {line}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      {logs.length > 0 && (
        <p className="text-xs text-muted-foreground">{logs.length} lines loaded</p>
      )}
    </div>
  )
}
