/**
 * Generic SpacetimeDB Query Passthrough
 *
 * GET /api/query/:resource?organizationId=...
 *
 * Maps resource names to serverQuery* functions. Returns data scoped to the
 * authenticated user's organization (resolved from session).
 *
 * Optional query params:
 *   - organizationId: Override org ID (falls back to session org)
 *
 * Available resources:
 *   Accounting: account-accounts, account-journals, account-moves, account-taxes,
 *               budgets, analytic-accounts
 *   Sales:      sale-orders, sale-order-lines, pricelists, picking-batches
 *   CRM:        leads, opportunities, contacts
 *   Projects:   projects, tasks, timesheets
 *   Inventory:  products, stock-quants, stock-pickings, warehouses, inventory-adjustments
 *   Purchasing: purchase-orders, purchase-order-lines, purchase-requisitions
 *   Manufacturing: mrp-productions, mrp-boms, mrp-workorders, mrp-workcenters
 *   HR:         employees, departments, leave-requests, contracts, payslips
 *   Reports:    financial-reports, trial-balances
 *   Other:      documents, knowledge-articles, helpdesk-tickets, subscriptions,
 *               subscription-plans, workflows, workflow-instances, proposals,
 *               calendar-events, mail-messages, expenses, expense-sheets,
 *               roles, user-roles
 */

import { type NextRequest, NextResponse } from 'next/server'
import { resolveApiSession } from '@/lib/api-session'
import {
  serverQueryAccountAccounts,
  serverQueryAccountJournals,
  serverQueryAccountMoves,
  serverQueryAccountTaxes,
  serverQueryBudgets,
  serverQueryAnalyticAccounts,
  serverQuerySaleOrders,
  serverQuerySaleOrderLines,
  serverQueryPricelists,
  serverQueryPickingBatches,
  serverQueryLeads,
  serverQueryOpportunities,
  serverQueryContacts,
  serverQueryProjects,
  serverQueryTasks,
  serverQueryTimesheets,
  serverQueryProducts,
  serverQueryStockQuants,
  serverQueryStockPickings,
  serverQueryWarehouses,
  serverQueryInventoryAdjustments,
  serverQueryPurchaseOrders,
  serverQueryPurchaseOrderLines,
  serverQueryPurchaseRequisitions,
  serverQueryMrpProductions,
  serverQueryMrpBoms,
  serverQueryMrpWorkorders,
  serverQueryMrpWorkcenters,
  serverQueryEmployees,
  serverQueryDepartments,
  serverQueryLeaveRequests,
  serverQueryContracts,
  serverQueryPayslips,
  serverQueryCalendarEvents,
  serverQueryDocuments,
  serverQueryKnowledgeArticles,
  serverQueryExpenses,
  serverQueryExpenseSheets,
  serverQueryHelpdeskTickets,
  serverQueryMailMessages,
  serverQueryFinancialReports,
  serverQueryTrialBalances,
  serverQuerySubscriptions,
  serverQuerySubscriptionPlans,
  serverQueryWorkflows,
  serverQueryWorkflowInstances,
  serverQueryProposals,
  serverQueryRoles,
  serverQueryUserRoleAssignments,
  type StdbHttpOptions,
} from '@lumiere/stdb/server'

type QueryFn = (orgId: number, opts?: StdbHttpOptions, identityHex?: string) => unknown[] | Promise<unknown[]>

const QUERY_MAP: Record<string, QueryFn> = {
  // Accounting
  'account-accounts': (orgId, opts) => serverQueryAccountAccounts(orgId, opts),
  'account-journals': (orgId, opts) => serverQueryAccountJournals(orgId, opts),
  'account-moves': (orgId, opts) => serverQueryAccountMoves(orgId, String(opts)),
  'account-taxes': (orgId, opts) => serverQueryAccountTaxes(orgId, opts),
  'budgets': (orgId, opts) => serverQueryBudgets(orgId, opts),
  'analytic-accounts': (orgId, opts) => serverQueryAnalyticAccounts(orgId, opts),
  // Sales
  'sale-orders': (orgId, opts) => serverQuerySaleOrders(orgId, opts),
  'sale-order-lines': (orgId, opts) => serverQuerySaleOrderLines(orgId, opts),
  'pricelists': (orgId, opts) => serverQueryPricelists(orgId, opts),
  'picking-batches': (orgId, opts) => serverQueryPickingBatches(orgId, opts),
  // CRM
  'leads': (orgId, opts) => serverQueryLeads(orgId, opts),
  'opportunities': (orgId, opts) => serverQueryOpportunities(orgId, opts),
  'contacts': (orgId, opts) => serverQueryContacts(orgId, opts),
  // Projects
  'projects': (orgId, opts) => serverQueryProjects(orgId, opts),
  'tasks': (orgId, opts) => serverQueryTasks(orgId, opts),
  'timesheets': (orgId, opts) => serverQueryTimesheets(orgId, opts),
  // Inventory
  'products': (orgId, opts) => serverQueryProducts(orgId, opts),
  'stock-quants': (orgId, opts) => serverQueryStockQuants(orgId, opts),
  'stock-pickings': (orgId, opts) => serverQueryStockPickings(orgId, opts),
  'warehouses': (orgId, opts) => serverQueryWarehouses(orgId, opts),
  'inventory-adjustments': (orgId, opts) => serverQueryInventoryAdjustments(orgId, opts),
  // Purchasing
  'purchase-orders': (orgId, opts) => serverQueryPurchaseOrders(orgId, opts),
  'purchase-order-lines': (orgId, opts) => serverQueryPurchaseOrderLines(orgId, opts),
  'purchase-requisitions': (orgId, opts) => serverQueryPurchaseRequisitions(orgId, opts),
  // Manufacturing
  'mrp-productions': (orgId, opts) => serverQueryMrpProductions(orgId, opts),
  'mrp-boms': (orgId, opts) => serverQueryMrpBoms(orgId, opts),
  'mrp-workorders': (orgId, opts) => serverQueryMrpWorkorders(orgId, opts),
  'mrp-workcenters': (orgId, opts) => serverQueryMrpWorkcenters(orgId, opts),
  // HR
  'employees': (orgId, opts) => serverQueryEmployees(orgId, opts),
  'departments': (orgId, opts) => serverQueryDepartments(orgId, opts),
  'leave-requests': (orgId, opts) => serverQueryLeaveRequests(orgId, opts),
  'contracts': (orgId, opts) => serverQueryContracts(orgId, opts),
  'payslips': (orgId, opts) => serverQueryPayslips(orgId, opts),
  // Reports
  'financial-reports': (orgId, opts) => serverQueryFinancialReports(orgId, opts),
  'trial-balances': (orgId, opts) => serverQueryTrialBalances(orgId, opts),
  // Other
  'documents': (orgId, opts) => serverQueryDocuments(orgId, opts),
  'knowledge-articles': (orgId, opts) => serverQueryKnowledgeArticles(orgId, opts),
  'helpdesk-tickets': (orgId, opts) => serverQueryHelpdeskTickets(orgId, opts),
  'subscriptions': (orgId, opts) => serverQuerySubscriptions(orgId, opts),
  'subscription-plans': (orgId, opts) => serverQuerySubscriptionPlans(orgId, opts),
  'workflows': (orgId, opts) => serverQueryWorkflows(orgId, opts),
  'workflow-instances': (orgId, opts) => serverQueryWorkflowInstances(orgId, opts),
  'proposals': (orgId, opts) => serverQueryProposals(orgId, opts),
  'calendar-events': (orgId, opts) => serverQueryCalendarEvents(orgId, opts),
  'mail-messages': (orgId, opts) => serverQueryMailMessages(orgId, opts),
  'expenses': (orgId, opts) => serverQueryExpenses(orgId, opts),
  'expense-sheets': (orgId, opts) => serverQueryExpenseSheets(orgId, opts),
  'roles': (_orgId, opts) => serverQueryRoles(opts),
  'user-roles': (_orgId, opts, identityHex) =>
    identityHex ? serverQueryUserRoleAssignments(identityHex, opts) : [],
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
): Promise<NextResponse> {
  const session = await resolveApiSession(request)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!session.organizationId) {
    return NextResponse.json({ error: 'No organization assigned' }, { status: 403 })
  }

  const { resource } = await params

  const queryFn = QUERY_MAP[resource]
  if (!queryFn) {
    return NextResponse.json(
      { error: `Unknown resource: "${resource}"`, available: Object.keys(QUERY_MAP) },
      { status: 404 },
    )
  }

  try {
    const data = await queryFn(session.organizationId, session.opts, session.identityHex)
    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Query failed'
    console.error(`[/api/query/${resource}]`, error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
