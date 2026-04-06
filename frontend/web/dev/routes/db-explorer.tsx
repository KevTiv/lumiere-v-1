import { apiFetch } from '@/lib/api-fetch'
import { createRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Route as rootRoute } from './__root'

const RESOURCE_GROUPS: Record<string, string[]> = {
  CRM: ['leads', 'opportunities', 'opportunity-stages', 'contacts', 'activities'],
  Sales: ['sale-orders', 'sale-order-lines', 'pricelists', 'pricelist-items', 'picking-batches'],
  Purchasing: ['purchase-orders', 'purchase-order-lines', 'purchase-requisitions', 'landed-costs', 'supplier-intakes'],
  Accounting: ['account-accounts', 'account-journals', 'account-moves', 'account-taxes', 'account-payments', 'budgets', 'analytic-accounts', 'bank-statements', 'bank-statement-lines', 'bank-match-candidates', 'account-reconciliation-widgets', 'account-assets'],
  Inventory: ['products', 'product-categories', 'uoms', 'stock-quants', 'stock-pickings', 'warehouses', 'inventory-adjustments', 'stock-locations', 'stock-production-lots', 'stock-production-serials', 'quality-checks', 'stock-cycle-counts', 'stock-inventories', 'stock-moves', 'stock-routes', 'stock-rules', 'picking-waves', 'warehouse-tasks', 'replenishment-rules', 'barcode-rules', 'adjustment-reasons', 'barcode-nomenclatures', 'serial-lot-traceability', 'stock-traceability-reports'],
  Manufacturing: ['mrp-productions', 'mrp-boms', 'mrp-bom-lines', 'mrp-workorders', 'mrp-workcenters', 'mrp-routing-workcenters'],
  HR: ['employees', 'departments', 'leave-requests', 'contracts', 'payslips'],
  Projects: ['projects', 'tasks', 'timesheets'],
  Reports: ['financial-reports', 'trial-balances'],
  IoT: [
    'iot-devices',
    'iot-hubs',
    'iot-alerts',
    'iot-actions',
    'iot-telemetry',
    'iot-thresholds',
    'iot-pairing-tokens',
  ],
  Other: ['documents', 'knowledge-articles', 'helpdesk-tickets', 'helpdesk-teams', 'helpdesk-stages', 'helpdesk-slas', 'subscriptions', 'subscription-plans', 'workflows', 'workflow-instances', 'proposals', 'calendar-events', 'mail-messages', 'expenses', 'expense-sheets', 'roles', 'user-roles'],
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/db-explorer',
  validateSearch: (search: Record<string, unknown>) => ({
    resource: (search.resource as string) ?? '',
    orgId: (search.orgId as string) ?? '',
  }),
  component: DbExplorerPage,
})

function DbExplorerPage() {
  const { resource: initialResource, orgId: initialOrgId } = Route.useSearch()
  const navigate = Route.useNavigate()

  const [resource, setResource] = useState(initialResource)
  const [orgId, setOrgId] = useState(initialOrgId)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<unknown[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['CRM', 'Sales']))

  const fetchData = async (res = resource, org = orgId) => {
    if (!res) return
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const params = new URLSearchParams()
      if (org) params.set('organizationId', org)
      const response = await apiFetch(`/api/query/${res}${params.toString() ? `?${params}` : ''}`)
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
        throw new Error(err.error ?? `HTTP ${response.status}`)
      }
      const json = await response.json()
      setData(Array.isArray(json) ? json : json.data ?? json)
      navigate({ search: { resource: res, orgId: org }, replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const selectResource = (r: string) => {
    setResource(r)
    fetchData(r, orgId)
  }

  const columns = data && data.length > 0 ? Object.keys(data[0] as object) : []

  return (
    <div className="flex h-full">
      {/* Resource list */}
      <aside className="w-52 shrink-0 border-r overflow-auto">
        <div className="p-3 border-b">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Resources</p>
        </div>
        {Object.entries(RESOURCE_GROUPS).map(([group, items]) => (
          <div key={group}>
            <button
              onClick={() => setExpandedGroups(prev => {
                const next = new Set(prev)
                next.has(group) ? next.delete(group) : next.add(group)
                return next
              })}
              className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              {group}
              <span>{expandedGroups.has(group) ? '−' : '+'}</span>
            </button>
            {expandedGroups.has(group) && items.map((r) => (
              <button
                key={r}
                onClick={() => selectResource(r)}
                className={`w-full text-left px-4 py-1 text-xs transition-colors ${
                  resource === r
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        ))}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 p-3 border-b">
          <input
            type="text"
            value={resource}
            onChange={(e) => setResource(e.target.value)}
            placeholder="resource name..."
            className="flex-1 rounded border px-2 py-1 text-sm font-mono focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="orgId (optional)"
            className="w-36 rounded border px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => fetchData()}
            disabled={loading || !resource}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Fetch'}
          </button>
          {data && (
            <span className="text-xs text-muted-foreground">{data.length} rows</span>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto p-3">
          {error && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          )}
          {!data && !error && !loading && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select a resource from the sidebar or type one above and click Fetch
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Loading...
            </div>
          )}
          {data && data.length === 0 && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No records found
            </div>
          )}
          {data && data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-muted sticky top-0">
                    {columns.map((col) => (
                      <th key={col} className="border px-2 py-1 text-left font-medium whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, i) => (
                    <tr key={i} className="hover:bg-muted/50">
                      {columns.map((col) => {
                        const val = (row as Record<string, unknown>)[col]
                        return (
                          <td key={col} className="border px-2 py-1 max-w-48 truncate font-mono" title={String(val ?? '')}>
                            {val === null || val === undefined
                              ? <span className="text-muted-foreground italic">null</span>
                              : typeof val === 'object'
                              ? <span className="text-blue-600">{JSON.stringify(val)}</span>
                              : String(val)
                            }
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
