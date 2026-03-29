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
 *               account-payments, budgets, analytic-accounts
 *   Sales:      sale-orders, sale-order-lines, pricelists, pricelist-items, picking-batches
 *   CRM:        leads, opportunities, opportunity-stages, contacts, activities
 *   Projects:   projects, tasks, timesheets
 *   Inventory:  products, product-categories, uoms, stock-quants, stock-pickings, warehouses, inventory-adjustments,
 *               stock-locations, stock-production-lots, stock-production-serials, quality-checks, warehouse-3d-zones,
 *               stock-cycle-counts, stock-inventories, stock-moves, stock-routes, stock-rules, picking-waves,
 *               warehouse-tasks, replenishment-rules, barcode-rules, inventory-valuations
 *   Purchasing: purchase-orders, purchase-order-lines, purchase-requisitions
 *   Manufacturing: mrp-productions, mrp-boms, mrp-bom-lines, mrp-workorders, mrp-workcenters
 *   HR:         employees, departments, leave-requests, contracts, payslips
 *   Reports:    financial-reports, trial-balances
 *   Other:      documents, knowledge-articles, helpdesk-tickets, helpdesk-teams,
 *               helpdesk-stages, helpdesk-slas, subscriptions,
 *               subscription-plans, deferred-revenue-schedules, deferred-revenue-lines,
 *               revenue-recognition-rules, workflows, workflow-activities, workflow-instances,
 *               workflow-transitions, workflow-workitems, proposals,
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
  serverQueryAccountPayments,
  serverQueryBudgets,
  serverQueryAnalyticAccounts,
  serverQuerySaleOrders,
  serverQuerySaleOrderLines,
  serverQueryPricelists,
  serverQueryPricelistItems,
  serverQueryPickingBatches,
  serverQueryLeads,
  serverQueryOpportunities,
  serverQueryOpportunityStages,
  serverQueryContacts,
  serverQueryActivities,
  serverQueryProjects,
  serverQueryTasks,
  serverQueryTimesheets,
  serverQueryProducts,
  serverQueryProductCategories,
  serverQueryUoms,
  serverQueryStockQuants,
  serverQueryStockPickings,
  serverQueryWarehouses,
  serverQueryInventoryAdjustments,
  serverQueryStockLocations,
  serverQueryStockProductionLots,
  serverQueryStockProductionSerials,
  serverQueryQualityChecks,
  serverQueryWarehouse3dZones,
  serverQueryStockCycleCounts,
  serverQueryStockInventories,
  serverQueryStockMoves,
  serverQueryStockRoutes,
  serverQueryStockRules,
  serverQueryPickingWaves,
  serverQueryWarehouseTasks,
  serverQueryReplenishmentRules,
  serverQueryBarcodeRules,
  serverQueryInventoryValuations,
  serverQueryPurchaseOrders,
  serverQueryPurchaseOrderLines,
  serverQueryPurchaseRequisitions,
  serverQueryMrpProductions,
  serverQueryMrpBoms,
  serverQueryMrpBomLines,
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
  serverQueryHelpdeskTeams,
  serverQueryHelpdeskStages,
  serverQueryHelpdeskSlas,
  serverQueryMailMessages,
  serverQueryFinancialReports,
  serverQueryTrialBalances,
  serverQueryReportTemplates,
  serverQueryScheduledReports,
  serverQueryAnalyticsMetrics,
  serverQuerySubscriptions,
  serverQuerySubscriptionPlans,
  serverQueryDeferredRevenueSchedules,
  serverQueryDeferredRevenueLines,
  serverQueryRevenueRecognitionRules,
  serverQueryWorkflows,
  serverQueryWorkflowActivities,
  serverQueryWorkflowInstances,
  serverQueryWorkflowTransitions,
  serverQueryWorkflowWorkitems,
  serverQueryProposals,
  serverQueryRoles,
  serverQueryUserRoleAssignments,
  type StdbServerQueryOptions,
} from '@lumiere/stdb/server'

type QueryFn = (
  orgId: number,
  opts?: StdbServerQueryOptions,
  identityHex?: string,
) => unknown[] | Promise<unknown[]>

const QUERY_MAP: Record<string, QueryFn> = {
  // Accounting
  'account-accounts': (orgId, opts) => serverQueryAccountAccounts(orgId, opts),
  'account-journals': (orgId, opts) => serverQueryAccountJournals(orgId, opts),
  'account-moves': (orgId, opts) => serverQueryAccountMoves(orgId, String(opts)),
  'account-taxes': (orgId, opts) => serverQueryAccountTaxes(orgId, opts),
  'account-payments': (orgId, opts) => serverQueryAccountPayments(orgId, opts),
  'budgets': (orgId, opts) => serverQueryBudgets(orgId, opts),
  'analytic-accounts': (orgId, opts) => serverQueryAnalyticAccounts(orgId, opts),
  // Sales
  'sale-orders': (orgId, opts) => serverQuerySaleOrders(orgId, opts),
  'sale-order-lines': (orgId, opts) => serverQuerySaleOrderLines(orgId, opts),
  'pricelists': (orgId, opts) => serverQueryPricelists(orgId, opts),
  'pricelist-items': (orgId, opts) => serverQueryPricelistItems(orgId, opts),
  'picking-batches': (orgId, opts) => serverQueryPickingBatches(orgId, opts),
  // CRM
  'leads': (orgId, opts) => serverQueryLeads(orgId, opts),
  'opportunities': (orgId, opts) => serverQueryOpportunities(orgId, opts),
  'opportunity-stages': (orgId, opts) => serverQueryOpportunityStages(orgId, opts),
  'contacts': (orgId, opts) => serverQueryContacts(orgId, opts),
  'activities': (orgId, opts) => serverQueryActivities(orgId, opts),
  // Projects
  'projects': (orgId, opts) => serverQueryProjects(orgId, opts),
  'tasks': (orgId, opts) => serverQueryTasks(orgId, opts),
  'timesheets': (orgId, opts) => serverQueryTimesheets(orgId, opts),
  // Inventory
  'products': (orgId, opts) => serverQueryProducts(orgId, opts),
  'product-categories': (orgId, opts) => serverQueryProductCategories(orgId, opts),
  'uoms': (orgId, opts) => serverQueryUoms(orgId, opts),
  'stock-quants': (orgId, opts) => serverQueryStockQuants(orgId, opts),
  'stock-pickings': (orgId, opts) => serverQueryStockPickings(orgId, opts),
  'warehouses': (orgId, opts) => serverQueryWarehouses(orgId, opts),
  'inventory-adjustments': (orgId, opts) => serverQueryInventoryAdjustments(orgId, opts),
  'stock-locations': (orgId, opts) => serverQueryStockLocations(orgId, opts),
  'stock-production-lots': (orgId, opts) => serverQueryStockProductionLots(orgId, opts),
  'stock-production-serials': (orgId, opts) => serverQueryStockProductionSerials(orgId, opts),
  'quality-checks': (orgId, opts) => serverQueryQualityChecks(orgId, opts),
  'warehouse-3d-zones': (orgId, opts) => serverQueryWarehouse3dZones(orgId, opts),
  'stock-cycle-counts': (orgId, opts) => serverQueryStockCycleCounts(orgId, opts),
  'stock-inventories': (orgId, opts) => serverQueryStockInventories(orgId, opts),
  'stock-moves': (orgId, opts) => serverQueryStockMoves(orgId, opts),
  'stock-routes': (orgId, opts) => serverQueryStockRoutes(orgId, opts),
  'stock-rules': (orgId, opts) => serverQueryStockRules(orgId, opts),
  'picking-waves': (orgId, opts) => serverQueryPickingWaves(orgId, opts),
  'warehouse-tasks': (orgId, opts) => serverQueryWarehouseTasks(orgId, opts),
  'replenishment-rules': (orgId, opts) => serverQueryReplenishmentRules(orgId, opts),
  'barcode-rules': (orgId, opts) => serverQueryBarcodeRules(orgId, opts),
  'inventory-valuations': (orgId, opts) => serverQueryInventoryValuations(orgId, opts),
  // Purchasing
  'purchase-orders': (orgId, opts) => serverQueryPurchaseOrders(orgId, opts),
  'purchase-order-lines': (orgId, opts) => serverQueryPurchaseOrderLines(orgId, opts),
  'purchase-requisitions': (orgId, opts) => serverQueryPurchaseRequisitions(orgId, opts),
  // Manufacturing
  'mrp-productions': (orgId, opts) => serverQueryMrpProductions(orgId, opts),
  'mrp-boms': (orgId, opts) => serverQueryMrpBoms(orgId, opts),
  'mrp-bom-lines': (orgId, opts) => serverQueryMrpBomLines(orgId, opts),
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
  'report-templates': (orgId, opts) => serverQueryReportTemplates(orgId, opts),
  'scheduled-reports': (orgId, opts) => serverQueryScheduledReports(orgId, opts),
  'analytics-metrics': (orgId, opts) => serverQueryAnalyticsMetrics(orgId, opts),
  // Other
  'documents': (orgId, opts) => serverQueryDocuments(orgId, opts),
  'knowledge-articles': (orgId, opts) => serverQueryKnowledgeArticles(orgId, opts),
  'helpdesk-tickets': (orgId, opts) => serverQueryHelpdeskTickets(orgId, opts),
  'helpdesk-teams': (orgId, opts) => serverQueryHelpdeskTeams(orgId, opts),
  'helpdesk-stages': (orgId, opts) => serverQueryHelpdeskStages(orgId, opts),
  'helpdesk-slas': (orgId, opts) => serverQueryHelpdeskSlas(orgId, opts),
  'subscriptions': (orgId, opts) => serverQuerySubscriptions(orgId, opts),
  'subscription-plans': (orgId, opts) => serverQuerySubscriptionPlans(orgId, opts),
  'deferred-revenue-schedules': (orgId, opts) =>
    serverQueryDeferredRevenueSchedules(orgId, opts),
  'deferred-revenue-lines': (orgId, opts) => serverQueryDeferredRevenueLines(orgId, opts),
  'revenue-recognition-rules': (orgId, opts) =>
    serverQueryRevenueRecognitionRules(orgId, opts),
  'workflows': (orgId, opts) => serverQueryWorkflows(orgId, opts),
  'workflow-activities': (orgId, opts) => serverQueryWorkflowActivities(orgId, opts),
  'workflow-instances': (orgId, opts) => serverQueryWorkflowInstances(orgId, opts),
  'workflow-transitions': (orgId, opts) => serverQueryWorkflowTransitions(orgId, opts),
  'workflow-workitems': (orgId, opts) => serverQueryWorkflowWorkitems(orgId, opts),
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
    const queryOpts: StdbServerQueryOptions = session.fieldAccess
      ? { ...session.opts, fieldAccess: session.fieldAccess }
      : session.opts
    const data = await queryFn(session.organizationId, queryOpts, session.identityHex)
    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Query failed'
    console.error(`[/api/query/${resource}]`, error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
