import { createRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { Route as rootRoute } from './__root'
import { ALL_REDUCER_NAMES, isValidReducerName } from '@/lib/reducer-names'

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/reducer-lab',
  validateSearch: (search: Record<string, unknown>) => ({
    reducer: (search.reducer as string) ?? '',
  }),
  component: ReducerLabPage,
})

function ReducerLabPage() {
  const { reducer: preselectedReducer } = Route.useSearch()
  const navigate = Route.useNavigate()

  const [reducerName, setReducerName] = useState(preselectedReducer)
  const [args, setArgs] = useState<string>('[]')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success?: boolean; message?: string; response?: unknown } | null>(null)
  const [recentCalls, setRecentCalls] = useState<Array<{ reducer: string; args: string; timestamp: number }>>([])
  const [filter, setFilter] = useState('')

  // Sync preselected reducer from URL
  useEffect(() => {
    if (preselectedReducer) setReducerName(preselectedReducer)
  }, [preselectedReducer])

  // Load recent calls from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('reducer-lab-recent')
    if (saved) {
      try {
        setRecentCalls(JSON.parse(saved))
      } catch {
        // ignore
      }
    }
  }, [])

  const addRecentCall = (reducer: string, args: string) => {
    const newCall = { reducer, args, timestamp: Date.now() }
    const updated = [newCall, ...recentCalls.slice(0, 19)]
    setRecentCalls(updated)
    localStorage.setItem('reducer-lab-recent', JSON.stringify(updated))
  }

  const filteredReducers = filter
    ? ALL_REDUCER_NAMES.filter((r) => r.toLowerCase().includes(filter.toLowerCase())).slice(0, 50)
    : []

  const isValidReducer = isValidReducerName(reducerName)
  const isValidJson = (() => {
    try {
      JSON.parse(args)
      return true
    } catch {
      return false
    }
  })()

  const handleCall = async () => {
    if (!isValidReducer || !isValidJson) return
    setLoading(true)
    setResult(null)
    try {
      const parsedArgs = JSON.parse(args)
      const url = `/api/compat/reducer/${reducerName}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedArgs),
      })
      const responseData = await response.json().catch(() => null)
      if (response.ok) {
        setResult({ success: true, message: 'Reducer call succeeded', response: responseData })
        addRecentCall(reducerName, args)
        // Update URL to reflect this reducer call
        navigate({ search: { reducer: reducerName }, replace: true })
      } else {
        setResult({
          success: false,
          message: responseData?.error ?? `HTTP ${response.status}`,
          response: responseData,
        })
      }
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      setLoading(false)
    }
  }

  const loadRecentCall = (call: { reducer: string; args: string }) => {
    setReducerName(call.reducer)
    setArgs(call.args)
    navigate({ search: { reducer: call.reducer }, replace: true })
  }

  const setPresetArgs = (preset: string) => {
    switch (preset) {
      case 'org-only': setArgs('["1"]'); break
      case 'org-with-company': setArgs('["1", "1"]'); break
      case 'org-and-params': setArgs('["1", {"name": "Test"}]'); break
      case 'empty': setArgs('[]'); break
    }
  }

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950">
        <h1 className="mb-2 text-xl font-bold text-yellow-900 dark:text-yellow-100">Reducer Lab</h1>
        <p className="text-sm text-yellow-800 dark:text-yellow-200">
          Developer tool for testing SpacetimeDB reducers directly. Be careful - this calls reducers against real data!
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Main form */}
        <div className="md:col-span-2 space-y-4 rounded-lg border p-4">
          <h2 className="text-lg font-semibold">Call Reducer</h2>

          <div>
            <label className="mb-1 block text-sm font-medium">Reducer Name</label>
            <input
              type="text"
              value={reducerName}
              onChange={(e) => setReducerName(e.target.value)}
              placeholder="e.g., create_product, post_account_move..."
              className="w-full rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            {!isValidReducer && reducerName && (
              <p className="mt-1 text-xs text-red-600">Unknown reducer name</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Or search reducers</label>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Type to filter reducer names..."
              className="w-full rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            {filter && filteredReducers.length > 0 && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-md border bg-white p-2 dark:bg-gray-900">
                {filteredReducers.map((r) => (
                  <button
                    key={r}
                    onClick={() => {
                      setReducerName(r)
                      setFilter('')
                      navigate({ search: { reducer: r }, replace: true })
                    }}
                    className="block w-full text-left px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Arguments (JSON array)</label>
            <textarea
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              rows={6}
              className="w-full rounded-md border px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none"
            />
            {!isValidJson && <p className="mt-1 text-xs text-red-600">Invalid JSON</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                { key: 'org-only', label: '[orgId]' },
                { key: 'org-with-company', label: '[orgId, companyId]' },
                { key: 'org-and-params', label: '[orgId, params]' },
                { key: 'empty', label: '[]' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setPresetArgs(key)}
                  className="rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleCall}
            disabled={loading || !isValidReducer || !isValidJson}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Calling...' : 'Call Reducer'}
          </button>

          {result && (
            <div
              className={`rounded-md border p-3 ${
                result.success
                  ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950'
                  : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950'
              }`}
            >
              <p className={`font-medium ${result.success ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
                {result.message}
              </p>
              {result.response != null && (
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-white p-2 text-xs dark:bg-gray-900">
                  {JSON.stringify(result.response, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-lg border p-4">
            <h3 className="mb-3 text-sm font-semibold">Recent Calls</h3>
            {recentCalls.length === 0 ? (
              <p className="text-xs text-gray-500">No recent calls</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {recentCalls.map((call, i) => (
                  <button
                    key={i}
                    onClick={() => loadRecentCall(call)}
                    className="block w-full rounded bg-gray-50 p-2 text-left text-xs hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800"
                  >
                    <span className="font-medium">{call.reducer}</span>
                    <span className="ml-2 text-gray-500">
                      {new Date(call.timestamp).toLocaleTimeString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border p-4">
            <h3 className="mb-3 text-sm font-semibold">Stats</h3>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Total reducers: {ALL_REDUCER_NAMES.length}
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <h3 className="mb-3 text-sm font-semibold">Tips</h3>
            <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
              <li>• Most reducers need [organizationId, ...args]</li>
              <li>• Supply organization and company arguments explicitly</li>
              <li>• Check browser Network tab for full details</li>
              <li>• URL updates when you call a reducer — bookmark it!</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
