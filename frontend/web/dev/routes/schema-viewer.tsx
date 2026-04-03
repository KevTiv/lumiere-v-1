import { createRoute } from '@tanstack/react-router'
import { useState, useMemo } from 'react'
import { Route as rootRoute } from './__root'
import { ALL_REDUCER_NAMES, PRODUCT_REDUCER_NAMES, isProductReducer } from '@/lib/reducer-names'

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/schema-viewer',
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string) ?? '',
    filter: (search.filter as 'all' | 'product' | 'internal') ?? 'all',
  }),
  component: SchemaViewerPage,
})

type FilterType = 'all' | 'product' | 'internal'

// Derive category from reducer name prefix
function getCategory(name: string): string {
  if (name.startsWith('create_account') || name.startsWith('update_account') || name.startsWith('delete_account') ||
      name.startsWith('post_account') || name.startsWith('cancel_account') || name.startsWith('close_account') ||
      name.startsWith('confirm_account') || name.startsWith('open_account') || name.includes('budget') ||
      name.includes('payment') || name.includes('invoice') || name.includes('fiscal') || name.includes('tax') ||
      name.includes('analytic') || name.includes('bank_statement') || name.includes('consolidation') ||
      name.includes('deferred') || name.includes('expense') || name.includes('payroll') || name.includes('payslip') ||
      name.includes('salary') || name.includes('asset')) return 'Accounting'
  if (name.includes('lead') || name.includes('opportunity') || name.includes('contact') || name.includes('segment') || name.includes('utm')) return 'CRM'
  if (name.includes('sale_order') || name.includes('pricelist') || name.includes('proposal') || name.includes('subscription') || name.includes('loyalty')) return 'Sales'
  if (name.includes('purchase') || name.includes('landed_cost') || name.includes('supplier_intake')) return 'Purchasing'
  if (name.includes('stock') || name.includes('warehouse') || name.includes('inventory') || name.includes('product') ||
      name.includes('barcode') || name.includes('uom') || name.includes('serial') || name.includes('lot') ||
      name.includes('delivery') || name.includes('picking') || name.includes('replenishment') || name.includes('quant') ||
      name.includes('traceability') || name.includes('cycle_count')) return 'Inventory'
  if (name.includes('mrp') || name.includes('manufacturing') || name.includes('bom') || name.includes('workorder') ||
      name.includes('workcenter') || name.includes('production')) return 'Manufacturing'
  if (name.includes('employee') || name.includes('department') || name.includes('leave') || name.includes('contract') ||
      name.includes('hr_') || name.includes('job_position') || name.includes('resource')) return 'HR'
  if (name.includes('project') || name.includes('task') || name.includes('timesheet')) return 'Projects'
  if (name.includes('helpdesk') || name.includes('ticket') || name.includes('sla')) return 'Helpdesk'
  if (name.includes('document') || name.includes('knowledge') || name.includes('article') || name.includes('folder')) return 'Documents'
  if (name.includes('iot') || name.includes('hub') || name.includes('device') || name.includes('telemetry')) return 'IoT'
  if (name.includes('workflow') || name.includes('workitem')) return 'Workflows'
  if (name.includes('calendar') || name.includes('activity')) return 'Calendar'
  if (name.includes('report') || name.includes('financial') || name.includes('trial_balance') || name.includes('analytics_metric')) return 'Reports'
  if (name.includes('org') || name.includes('company') || name.includes('role') || name.includes('user') ||
      name.includes('invite') || name.includes('credential') || name.includes('casbin') || name.includes('session')) return 'Auth/Org'
  if (name.startsWith('import_') || name.startsWith('seed_') || name.startsWith('bootstrap') || name.startsWith('migrate')) return 'Data Ops'
  return 'Other'
}

function SchemaViewerPage() {
  const { q, filter } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [search, setSearch] = useState(q)
  const [activeFilter, setActiveFilter] = useState<FilterType>(filter)

  const filtered = useMemo(() => {
    return ALL_REDUCER_NAMES.filter((name) => {
      const matchesSearch = !search || name.toLowerCase().includes(search.toLowerCase())
      const matchesFilter =
        activeFilter === 'all' ||
        (activeFilter === 'product' && isProductReducer(name)) ||
        (activeFilter === 'internal' && !isProductReducer(name))
      return matchesSearch && matchesFilter
    })
  }, [search, activeFilter])

  const grouped = useMemo(() => {
    const groups: Record<string, string[]> = {}
    for (const name of filtered) {
      const cat = getCategory(name)
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(name)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const updateSearch = (val: string) => {
    setSearch(val)
    navigate({ search: { q: val, filter: activeFilter }, replace: true })
  }

  const updateFilter = (f: FilterType) => {
    setActiveFilter(f)
    navigate({ search: { q: search, filter: f }, replace: true })
  }

  return (
    <div className="flex h-full flex-col p-4 gap-4">
      <div>
        <h1 className="text-lg font-semibold mb-1">Schema Viewer</h1>
        <p className="text-sm text-muted-foreground">
          {ALL_REDUCER_NAMES.length} total reducers · {PRODUCT_REDUCER_NAMES.length} product · {ALL_REDUCER_NAMES.length - PRODUCT_REDUCER_NAMES.length} internal
        </p>
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => updateSearch(e.target.value)}
          placeholder="Search reducers..."
          className="flex-1 rounded border px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
        />
        <div className="flex rounded border overflow-hidden">
          {(['all', 'product', 'internal'] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => updateFilter(f)}
              className={`px-3 py-2 text-xs capitalize transition-colors ${
                activeFilter === f ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{filtered.length} results</p>

      {/* Grouped results */}
      <div className="flex-1 overflow-auto space-y-4">
        {grouped.map(([group, names]) => (
          <div key={group}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {group} <span className="font-normal">({names.length})</span>
            </h3>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {names.map((name) => (
                <div
                  key={name}
                  className={`rounded px-2 py-1 text-xs font-mono border ${
                    isProductReducer(name)
                      ? 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300'
                      : 'border-muted bg-muted/30 text-muted-foreground'
                  }`}
                >
                  {name}
                </div>
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            No reducers match your search
          </div>
        )}
      </div>
    </div>
  )
}
