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
 *   Accounting: account-accounts, account-account-types, account-groups, account-journals, account-moves, account-taxes,
 *               account-payments, account-payment-terms, account-payment-term-lines, budgets, budget-lines, budget-posts, analytic-accounts, analytic-lines,
 *               analytic-distribution-models, bank-statements, bank-statement-lines,
 *               bank-match-candidates, account-reconciliation-widgets, account-assets, fiscal-years, account-periods
 *   Sales:      sale-orders, sale-order-lines, pricelists, pricelist-items, picking-batches
 *   CRM:        leads, opportunities, opportunity-stages, contacts, activities
 *   Projects:   projects, tasks, timesheets
 *   Inventory:  products, product-categories, uoms, stock-quants, stock-pickings, warehouses, inventory-adjustments,
 *               stock-locations, stock-production-lots, stock-production-serials, quality-checks, warehouse-3d-zones,
 *               stock-cycle-counts, stock-inventories, stock-moves, stock-routes, stock-rules, picking-waves,
 *               warehouse-tasks, replenishment-rules, barcode-rules, barcode-nomenclatures,
 *               adjustment-reasons, serial-lot-traceability, stock-traceability-reports, inventory-valuations
 *   Purchasing: purchase-orders, purchase-order-lines, purchase-requisitions, landed-costs, supplier-intakes
 *   Manufacturing: mrp-productions, mrp-boms, mrp-bom-lines, mrp-workorders, mrp-workcenters,
 *               mrp-routing-workcenters
 *   HR:         employees, departments, leave-requests, contracts, payslips
 *   Reports:    financial-reports, trial-balances
 *   IoT:        iot-devices, iot-hubs, iot-alerts, iot-actions, iot-telemetry, iot-thresholds,
 *               iot-pairing-tokens
 *   AI:         ai-agents, ai-team-members, ai-insights, ai-document-processing-jobs
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
  serverQueryAccountAccountTypes,
  serverQueryAccountGroups,
  serverQueryAccountJournals,
  serverQueryAccountMoves,
  serverQueryAccountTaxes,
  serverQueryAccountPayments,
  serverQueryAccountPaymentTerms,
  serverQueryAccountPaymentTermLines,
  serverQueryBudgets,
  serverQueryBudgetLines,
  serverQueryBudgetPosts,
  serverQueryAnalyticAccounts,
  serverQueryAnalyticLines,
  serverQueryAnalyticDistributionModels,
  serverQuerySaleOrders,
  serverQuerySaleOrderLines,
  serverQueryPricelists,
  serverQueryPricelistItems,
  serverQueryPickingBatches,
  serverQueryDeliveryCarriers,
  serverQueryDeliveryPriceRules,
  serverQueryShippingMethods,
  serverQueryPosPaymentMethods,
  serverQueryPosLoyaltyPrograms,
  serverQueryPosLoyaltyCards,
  serverQueryPartnerBanks,
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
  serverQueryAdjustmentReasons,
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
  serverQueryBarcodeNomenclatures,
  serverQuerySerialLotTraceability,
  serverQueryStockTraceabilityReports,
  serverQueryInventoryValuations,
  serverQueryPurchaseOrders,
  serverQueryPurchaseOrderLines,
  serverQueryPurchaseRequisitions,
  serverQueryLandedCosts,
  serverQuerySupplierIntakes,
  serverQueryMrpProductions,
  serverQueryMrpBoms,
  serverQueryMrpBomLines,
  serverQueryMrpWorkorders,
  serverQueryMrpWorkcenters,
  serverQueryMrpRoutingWorkcenters,
  serverQueryEmployees,
  serverQueryDepartments,
  serverQueryJobPositions,
  serverQueryLeaveRequests,
  serverQueryContracts,
  serverQueryPayslips,
  serverQueryLeaveTypes,
  serverQueryPayrollStructures,
  serverQuerySalaryRules,
  serverQueryHrResources,
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
  serverQueryProposalSections,
  serverQueryProposalLineItems,
  serverQueryProposalVersions,
  serverQueryProposalSourceDocs,
  serverQueryProposalPresence,
  serverQueryProposalComments,
  serverQueryFleetVehicles,
  serverQueryPosTerminals,
  serverQueryRoles,
  serverQueryUserRoleAssignments,
  serverQueryIotDevices,
  serverQueryIotHubs,
  serverQueryIotAlerts,
  serverQueryIotActions,
  serverQueryIotTelemetry,
  serverQueryIotThresholds,
  serverQueryIotPairingTokens,
  serverQueryAiAgents,
  serverQueryAiTeamMembers,
  serverQueryAiInsights,
  serverQueryAiDocumentProcessingJobs,
  serverQueryBankStatements,
  serverQueryBankStatementLines,
  serverQueryBankMatchCandidates,
  serverQueryAccountReconciliationWidgets,
  serverQueryAccountAssets,
  serverQueryFiscalYears,
  serverQueryAccountPeriods,
  serverQueryCompanies,
  serverQueryDataClassifications,
  serverQueryDataClassificationRules,
  serverQueryConsolidationAccounts,
  serverQueryConsolidationJournals,
  serverQueryConsolidationEliminationEntries,
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
  'account-account-types': (orgId, opts) => serverQueryAccountAccountTypes(orgId, opts),
  'account-groups': (orgId, opts) => serverQueryAccountGroups(orgId, opts),
  'account-journals': (orgId, opts) => serverQueryAccountJournals(orgId, opts),
  'account-moves': (orgId, opts) => serverQueryAccountMoves(orgId, String(opts)),
  'account-taxes': (orgId, opts) => serverQueryAccountTaxes(orgId, opts),
  'account-payments': (orgId, opts) => serverQueryAccountPayments(orgId, opts),
  'account-payment-terms': (orgId, opts) => serverQueryAccountPaymentTerms(orgId, opts),
  'account-payment-term-lines': (orgId, opts) => serverQueryAccountPaymentTermLines(orgId, opts),
  'budgets': (orgId, opts) => serverQueryBudgets(orgId, opts),
  'budget-lines': (orgId, opts) => serverQueryBudgetLines(orgId, opts),
  'budget-posts': (orgId, opts) => serverQueryBudgetPosts(orgId, opts),
  'analytic-accounts': (orgId, opts) => serverQueryAnalyticAccounts(orgId, opts),
  'analytic-lines': (orgId, opts) => serverQueryAnalyticLines(orgId, opts),
  'analytic-distribution-models': (orgId, opts) =>
    serverQueryAnalyticDistributionModels(orgId, opts),
  'bank-statements': (orgId, opts) => serverQueryBankStatements(orgId, opts),
  'bank-statement-lines': (orgId, opts) => serverQueryBankStatementLines(orgId, opts),
  'bank-match-candidates': (orgId, opts) => serverQueryBankMatchCandidates(orgId, opts),
  'account-reconciliation-widgets': (orgId, opts) =>
    serverQueryAccountReconciliationWidgets(orgId, opts),
  'account-assets': (orgId, opts) => serverQueryAccountAssets(orgId, opts),
  'fiscal-years': (orgId, opts) => serverQueryFiscalYears(orgId, opts),
  'account-periods': (orgId, opts) => serverQueryAccountPeriods(orgId, opts),
  companies: (orgId, opts) => serverQueryCompanies(orgId, opts),
  'data-classifications': (orgId, opts) => serverQueryDataClassifications(orgId, opts),
  'data-classification-rules': (orgId, opts) => serverQueryDataClassificationRules(orgId, opts),
  'consolidation-accounts': (orgId, opts) => serverQueryConsolidationAccounts(orgId, opts),
  'consolidation-journals': (orgId, opts) => serverQueryConsolidationJournals(orgId, opts),
  'consolidation-elimination-entries': (orgId, opts) =>
    serverQueryConsolidationEliminationEntries(orgId, opts),
  // Sales
  'sale-orders': (orgId, opts) => serverQuerySaleOrders(orgId, opts),
  'sale-order-lines': (orgId, opts) => serverQuerySaleOrderLines(orgId, opts),
  'pricelists': (orgId, opts) => serverQueryPricelists(orgId, opts),
  'pricelist-items': (orgId, opts) => serverQueryPricelistItems(orgId, opts),
  'picking-batches': (orgId, opts) => serverQueryPickingBatches(orgId, opts),
  'delivery-carriers': (orgId, opts) => serverQueryDeliveryCarriers(orgId, opts),
  'delivery-price-rules': (orgId, opts) => serverQueryDeliveryPriceRules(orgId, opts),
  'shipping-methods': (orgId, opts) => serverQueryShippingMethods(orgId, opts),
  'pos-payment-methods': (orgId, opts) => serverQueryPosPaymentMethods(orgId, opts),
  'pos-loyalty-programs': (orgId, opts) => serverQueryPosLoyaltyPrograms(orgId, opts),
  'pos-loyalty-cards': (orgId, opts) => serverQueryPosLoyaltyCards(orgId, opts),
  'partner-banks': (orgId, opts) => serverQueryPartnerBanks(orgId, opts),
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
  'adjustment-reasons': (orgId, opts) => serverQueryAdjustmentReasons(orgId, opts),
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
  'barcode-nomenclatures': (orgId, opts) => serverQueryBarcodeNomenclatures(orgId, opts),
  'serial-lot-traceability': (orgId, opts) => serverQuerySerialLotTraceability(orgId, opts),
  'stock-traceability-reports': (orgId, opts) => serverQueryStockTraceabilityReports(orgId, opts),
  'inventory-valuations': (orgId, opts) => serverQueryInventoryValuations(orgId, opts),
  // Purchasing
  'purchase-orders': (orgId, opts) => serverQueryPurchaseOrders(orgId, opts),
  'purchase-order-lines': (orgId, opts) => serverQueryPurchaseOrderLines(orgId, opts),
  'purchase-requisitions': (orgId, opts) => serverQueryPurchaseRequisitions(orgId, opts),
  'landed-costs': (orgId, opts) => serverQueryLandedCosts(orgId, opts),
  'supplier-intakes': (orgId, opts) => serverQuerySupplierIntakes(orgId, opts),
  // Manufacturing
  'mrp-productions': (orgId, opts) => serverQueryMrpProductions(orgId, opts),
  'mrp-boms': (orgId, opts) => serverQueryMrpBoms(orgId, opts),
  'mrp-bom-lines': (orgId, opts) => serverQueryMrpBomLines(orgId, opts),
  'mrp-workorders': (orgId, opts) => serverQueryMrpWorkorders(orgId, opts),
  'mrp-workcenters': (orgId, opts) => serverQueryMrpWorkcenters(orgId, opts),
  'mrp-routing-workcenters': (orgId, opts) => serverQueryMrpRoutingWorkcenters(orgId, opts),
  // HR
  'employees': (orgId, opts) => serverQueryEmployees(orgId, opts),
  'departments': (orgId, opts) => serverQueryDepartments(orgId, opts),
  'job-positions': (orgId, opts) => serverQueryJobPositions(orgId, opts),
  'leave-requests': (orgId, opts) => serverQueryLeaveRequests(orgId, opts),
  'contracts': (orgId, opts) => serverQueryContracts(orgId, opts),
  'payslips': (orgId, opts) => serverQueryPayslips(orgId, opts),
  'leave-types': (orgId, opts) => serverQueryLeaveTypes(orgId, opts),
  'payroll-structures': (orgId, opts) => serverQueryPayrollStructures(orgId, opts),
  'salary-rules': (orgId, opts) => serverQuerySalaryRules(orgId, opts),
  'hr-resources': (orgId, opts) => serverQueryHrResources(orgId, opts),
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
  'proposal-sections': (orgId, opts) => serverQueryProposalSections(orgId, opts),
  'proposal-line-items': (orgId, opts) => serverQueryProposalLineItems(orgId, opts),
  'proposal-versions': (orgId, opts) => serverQueryProposalVersions(orgId, opts),
  'proposal-source-docs': (orgId, opts) => serverQueryProposalSourceDocs(orgId, opts),
  'proposal-presence': (orgId, opts) => serverQueryProposalPresence(orgId, opts),
  'proposal-comments': (orgId, opts) => serverQueryProposalComments(orgId, opts),
  'fleet-vehicles': (orgId, opts) => serverQueryFleetVehicles(orgId, opts),
  'pos-terminals': (orgId, opts) => serverQueryPosTerminals(orgId, opts),
  // IoT
  'iot-devices': (orgId, opts) => serverQueryIotDevices(orgId, opts),
  'iot-hubs': (orgId, opts) => serverQueryIotHubs(orgId, opts),
  'iot-alerts': (orgId, opts) => serverQueryIotAlerts(orgId, opts),
  'iot-actions': (orgId, opts) => serverQueryIotActions(orgId, opts),
  'iot-telemetry': (orgId, opts) => serverQueryIotTelemetry(orgId, opts),
  'iot-thresholds': (orgId, opts) => serverQueryIotThresholds(orgId, opts),
  'iot-pairing-tokens': (orgId, opts) => serverQueryIotPairingTokens(orgId, opts),
  'ai-agents': (orgId, opts) => serverQueryAiAgents(orgId, opts),
  'ai-team-members': (orgId, opts) => serverQueryAiTeamMembers(orgId, opts),
  'ai-insights': (orgId, opts) => serverQueryAiInsights(orgId, opts),
  'ai-document-processing-jobs': (orgId, opts) =>
    serverQueryAiDocumentProcessingJobs(orgId, opts),
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
