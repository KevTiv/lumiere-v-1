import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getBrowserStdbSession } from '@/lib/browser-session'
import { resolveApiServerBaseUrl } from '@/lib/api-server-forward'
import { canInspectDemo } from '@/lib/demo-access-policy'

export const dynamic = 'force-dynamic'

const modules = [
  ['CRM', '/crm', ['contacts', 'leads', 'opportunities']],
  ['Sales', '/sales', ['sale-orders', 'sale-order-lines']],
  ['Purchasing', '/purchasing', ['purchase-orders', 'purchase-order-lines']],
  ['Inventory / WMS', '/inventory', ['products', 'warehouses', 'stock-quants']],
  ['Manufacturing', '/manufacturing', ['mrp-boms', 'mrp-productions', 'mrp-workorders']],
  ['Accounting', '/accounting', ['account-accounts', 'account-journals', 'account-moves']],
  ['HR / Payroll', '/hr', ['employees', 'contracts', 'payslips']],
  ['Projects / Tasks', '/projects', ['projects', 'tasks', 'timesheets']],
  ['Expenses', '/expenses', ['expenses', 'expense-sheets']],
  ['Reports', '/reports', ['financial-reports', 'saved-reports']],
  ['Documents', '/documents', ['documents', 'knowledge-articles']],
  ['Approvals / Workflows', '/workflows', ['workflows', 'workflow-human-tasks-inbox']],
  ['Forms / Imports', '/settings', ['form-configs', 'import-jobs']],
  ['Settings / Auth', '/settings', ['roles', 'companies']],
  ['Helpdesk', '/helpdesk', ['helpdesk-tickets']],
  ['Fleet', '/fleet', ['fleet-vehicles']],
  ['POS', '/pos', ['pos-configs']],
  ['Subscriptions', '/subscriptions', ['subscription-plans']],
] as const

export default async function DemoReadinessPage() {
  const session = await getBrowserStdbSession()
  if (!session) redirect('/sign-in?callbackUrl=%2Fdemo-readiness')
  if (!canInspectDemo(process.env.LUMIERE_DEMO_ORGANIZATION_ID, session.organizationId, session.fieldAccess?.roleName)) notFound()
  const base = resolveApiServerBaseUrl()
  if (!base) throw new Error('Demo diagnostics require the configured API server')

  const checks = []
  // Bounded concurrency: at most three tenant-authorized reads at once.
  for (const [name, href, resources] of modules) {
    const results = await Promise.all(resources.map(async resource => {
      try {
        const response = await fetch(`${base}/v1/query/${resource}`, {
          headers: { Authorization: `Bearer ${session.stdbToken}` },
          cache: 'no-store', signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) return { resource, label: `Query failed (HTTP ${response.status})`, ready: false }
        const body: unknown = await response.json()
        const rows = body && typeof body === 'object' && 'data' in body ? body.data : undefined
        if (!Array.isArray(rows)) return { resource, label: 'Unexpected query response', ready: false }
        return { resource, label: rows.length ? `${rows.length} rows returned` : 'Empty — inspect setup or workflow state', ready: rows.length > 0 }
      } catch {
        return { resource, label: 'Query unavailable — inspect service or permissions', ready: false }
      }
    }))
    checks.push({ name, href, results })
  }

  return <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
    <Link className="text-sm underline" href="/overview">Back to workspace</Link>
    <header className="space-y-2">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">Alpha · administrator preview</p>
      <h1 className="text-3xl font-semibold">Demo data &amp; module gaps</h1>
      <p className="max-w-3xl text-sm text-muted-foreground">These are live, permission-checked reads. Data present does not mean a module is U5 or fully tested. Empty approval queues can be expected until you submit a business action.</p>
      <p className="text-sm">All Alpha demo records are synthetic. Invoices, payroll, manufacturing and subscriptions are drafts or inactive; no payment, tax filing, email or AI-provider execution is seeded.</p>
    </header>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {checks.map(check => <section key={check.name} className="rounded-xl border border-border p-4">
        <Link className="font-semibold underline underline-offset-4" href={check.href}>{check.name}</Link>
        <ul className="mt-3 space-y-2 text-sm">
          {check.results.map(result => <li key={result.resource}>
            <span className="block text-xs text-muted-foreground">{result.resource}</span>
            <span className={result.ready ? 'text-foreground' : 'text-amber-600 dark:text-amber-400'}>{result.label}</span>
          </li>)}
        </ul>
      </section>)}
    </div>
  </main>
}
