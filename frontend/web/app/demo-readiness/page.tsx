import { DemoReadinessContent, type DemoReadinessCheck, type DemoReadinessResult } from "./readiness-content"
import { notFound, redirect } from 'next/navigation'
import { getBrowserStdbSession } from '@/lib/browser-session'
import { resolveApiServerBaseUrl } from '@/lib/api-server-forward'
import { canInspectDemo } from '@/lib/demo-access-policy'

export const dynamic = 'force-dynamic'

const modules = [
  ['crm', '/crm', ['contacts', 'leads', 'opportunities']],
  ['sales', '/sales', ['sale-orders', 'sale-order-lines']],
  ['purchasing', '/purchasing', ['purchase-orders', 'purchase-order-lines']],
  ['inventory', '/inventory', ['products', 'warehouses', 'stock-quants']],
  ['manufacturing', '/manufacturing', ['mrp-boms', 'mrp-productions', 'mrp-workorders']],
  ['accounting', '/accounting', ['account-accounts', 'account-journals', 'account-moves']],
  ['hr', '/hr', ['employees', 'contracts', 'payslips']],
  ['projects', '/projects', ['projects', 'tasks', 'timesheets']],
  ['expenses', '/expenses', ['expenses', 'expense-sheets']],
  ['reports', '/reports', ['financial-reports', 'saved-reports']],
  ['documents', '/documents', ['documents', 'knowledge-articles']],
  ['workflows', '/workflows', ['workflows', 'workflow-human-tasks-inbox']],
  ['forms', '/settings', ['form-configs', 'import-jobs']],
  ['settings', '/settings', ['roles', 'companies']],
  ['helpdesk', '/helpdesk', ['helpdesk-tickets']],
  ['fleet', '/fleet', ['fleet-vehicles']],
  ['pos', '/pos', ['pos-configs']],
  ['subscriptions', '/subscriptions', ['subscription-plans']],
] as const

export default async function DemoReadinessPage() {
  const session = await getBrowserStdbSession()
  if (!session) redirect('/sign-in?callbackUrl=%2Fdemo-readiness')
  if (!canInspectDemo(process.env.LUMIERE_DEMO_ORGANIZATION_ID, session.organizationId, session.fieldAccess?.roleName)) notFound()
  const base = resolveApiServerBaseUrl()
  if (!base) throw new Error('Demo diagnostics require the configured API server')

  const checks: DemoReadinessCheck[] = []
  // Bounded concurrency: at most three tenant-authorized reads at once.
  for (const [moduleKey, href, resources] of modules) {
    const results = await Promise.all(resources.map(async (resource): Promise<DemoReadinessResult> => {
      try {
        const response = await fetch(`${base}/v1/query/${resource}`, {
          headers: { Authorization: `Bearer ${session.stdbToken}` },
          cache: 'no-store', signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) return { resource, status: "http-error", httpStatus: response.status }
        const body: unknown = await response.json()
        const rows = body && typeof body === 'object' && 'data' in body ? body.data : undefined
        if (!Array.isArray(rows)) return { resource, status: "unexpected-response" }
        return { resource, status: "rows", count: rows.length }
      } catch {
        return { resource, status: "unavailable" }
      }
    }))
    checks.push({ moduleKey, href, results })
  }

  return <DemoReadinessContent checks={checks} />
}
