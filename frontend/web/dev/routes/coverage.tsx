import { createRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { Route as rootRoute } from './__root'
import { ALL_REDUCER_NAMES, PRODUCT_REDUCER_NAMES } from '@/lib/reducer-names'
import { Link } from '@tanstack/react-router'

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/coverage',
  component: CoveragePage,
})

interface CoverageReport {
  [reducer: string]: {
    covered: boolean
    files?: string[]
    calledAt?: string[]
  }
}

function CoveragePage() {
  const [report, setReport] = useState<CoverageReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/reducer-coverage-report.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setReport)
      .catch((err) => setError(err.message))
  }, [])

  const covered = report
    ? PRODUCT_REDUCER_NAMES.filter((name) => report[name]?.covered)
    : []
  const uncovered = PRODUCT_REDUCER_NAMES.filter((name) => !report?.[name]?.covered)
  const coveragePercent = PRODUCT_REDUCER_NAMES.length > 0
    ? Math.round((covered.length / PRODUCT_REDUCER_NAMES.length) * 100)
    : 0

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold mb-1">Reducer Coverage</h1>
        <p className="text-sm text-muted-foreground">
          Which product reducers have UI coverage
        </p>
      </div>

      {error && (
        <div className="rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-200">
          Could not load coverage report: {error}.{' '}
          <span>Run <code className="font-mono text-xs bg-muted px-1 rounded">pnpm coverage</code> to generate it.</span>
        </div>
      )}

      {report && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded border p-4">
              <p className="text-2xl font-bold">{coveragePercent}%</p>
              <p className="text-xs text-muted-foreground mt-1">Overall coverage</p>
            </div>
            <div className="rounded border p-4">
              <p className="text-2xl font-bold text-green-600">{covered.length}</p>
              <p className="text-xs text-muted-foreground mt-1">Covered</p>
            </div>
            <div className="rounded border p-4">
              <p className="text-2xl font-bold text-red-500">{uncovered.length}</p>
              <p className="text-xs text-muted-foreground mt-1">Uncovered</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="rounded-full bg-muted overflow-hidden h-2">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${coveragePercent}%` }}
            />
          </div>

          {/* Uncovered reducers */}
          {uncovered.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 text-red-600">Uncovered ({uncovered.length})</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                {uncovered.map((name) => (
                  <Link
                    key={name}
                    to="/dev/reducer-lab"
                    search={{ reducer: name }}
                    className="rounded px-2 py-1 text-xs font-mono border border-red-200 bg-red-50 text-red-900 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60 transition-colors"
                  >
                    {name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Covered reducers */}
          <div>
            <h3 className="text-sm font-semibold mb-2 text-green-600">Covered ({covered.length})</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
              {covered.map((name) => (
                <div key={name} className="rounded px-2 py-1 text-xs font-mono border border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
                  {name}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!report && !error && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          Loading coverage report...
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        Total reducers: {ALL_REDUCER_NAMES.length} all · {PRODUCT_REDUCER_NAMES.length} product
      </div>
    </div>
  )
}
