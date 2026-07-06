/**
 * Server-side STDB HTTP bridge for Next.js route handlers (auth, admin SQL).
 *
 * **Reads:** RSC pages use `frontend/web/lib/server-query.ts` → api-server `query_exec.rs`.
 * **Subscriptions:** WebSocket SQL uses `field-policy.ts` + `erp-subscriptions.ts`.
 *
 * Import from `@lumiere/stdb/server` in API routes and server actions only — not in client components.
 */

import { stdbSql, type StdbHttpOptions } from './http'

export type { StdbHttpOptions }
export { stdbSql }
export type { FieldAccessContext, QueryResourceKey } from './field-policy'

// ── Entity type re-exports for API route handlers ────────────────────────────
export type {
  // CRM
  Lead, Contact, Opportunity, Activity,
  CreateLeadParams, CreateContactParams, CreateOpportunityParams,
  // Sales
  SaleOrder, SaleOrderLine, ProductPricelist, ProductPricelistItem,
  CreateSaleOrderParams, CreateSaleOrderLineParams, CreatePricelistParams,
  UpdateSaleOrderParams,
  // Accounting
  AccountAccount, AccountJournal, AccountMove, AccountTax,
  AccountAnalyticAccount, AccountBankStatement, AccountAsset,
  AccountMoveState,
  CreateAccountMoveParams, CreateAccountAccountParams, CreateAccountTaxParams,
  CreateCrossoveredBudgetParams,
  MoveType,
  // Inventory
  Product, StockQuant, StockPicking, Warehouse, InventoryAdjustment,
  StockLocation, StockProductionLot, QualityCheck, Warehouse3DZone, StockCycleCount,
  PickingWave, WarehouseTask, StockRoute, StockRule, ReplenishmentRule, BarcodeRule,
  StockMove, StockInventory, InventoryValuation,
  // Purchasing
  PurchaseOrder, PurchaseOrderLine, PurchaseRequisition,
  StockLandedCost, SupplierIntakeRequest,
  CreatePurchaseOrderParams, CreatePurchaseRequisitionParams,
  // Manufacturing
  MrpProduction, MrpBom, MrpWorkorder, MrpWorkcenter,
  CreateMrpProductionParams,
  // HR
  HrEmployee, HrDepartment, HrJobPosition, HrLeave, HrContract, HrPayslip,
  HrLeaveType, HrPayrollStructure, HrSalaryRule, HrResource,
  CreateEmployeeParams,
  EmploymentType,
  // Projects
  ProjectProject, ProjectTask, ProjectTimesheet,
  CreateProjectParams, CreateTaskParams,
  // Documents
  Document, KnowledgeArticle,
  CreateDocumentParams,
  // Helpdesk
  HelpdeskTicket,
  CreateTicketParams,
  TicketPriority,
  // Calendar / Expenses
  CalendarEvent, HrExpense,
  // IoT
  IoTDevice, IoTHub, IoTAlert, IoTAction, IoTTelemetry, IoTThreshold,
  // Settings / Auth
  UserProfile, Role, UserRoleAssignment,
} from './generated/types'
