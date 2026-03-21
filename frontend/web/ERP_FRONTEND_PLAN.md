# ERP Frontend Expansion Plan

> Generated: 2026-03-17
> Based on: report of missing ERP modules, SpacetimeDB table inventory, and current frontend audit

---

## Current State Summary

### Existing Module Pages (have `*-client.tsx` + dashboard configs)
| Module | Route | Client Component | Backend Tables Used |
|--------|-------|-----------------|---------------------|
| Accounting | `/accounting` | `accounting-client.tsx` | AccountAccount, AccountMove, AccountTax, CrossoveredBudget, AccountAnalyticAccount |
| Sales | `/sales` | `sales-client.tsx` | SaleOrder, SaleOrderLine, ProductPricelist |
| CRM | `/crm` | `crm-client.tsx` | Contact, Lead, Opportunity, Activity |
| Inventory | `/inventory` | `inventory-client.tsx` | Product, StockQuant, StockPicking, StockInventory |
| Purchasing | `/purchasing` | `purchasing-client.tsx` | PurchaseOrder, PurchaseOrderLine, PurchaseRequisition |
| Manufacturing | `/manufacturing` | `manufacturing-client.tsx` | MrpBom, MrpProduction, MrpWorkorder, MrpWorkcenter |
| HR | `/hr` | `hr-client.tsx` | HrEmployee, HrDepartment, HrLeave, HrContract, HrPayslip |
| Projects | `/projects` | `projects-client.tsx` | ProjectProject, ProjectTask, ProjectTimesheet |

### Stub Pages (exist but no client component)
| Route | Status |
|-------|--------|
| `/iot` | Dashboard config exists in `module-dashboard-configs.ts`, no `iot-client.tsx` |
| `/tasks` | Page exists, no client component |
| `/trackers` | Page exists, no client component |
| `/forensics` | Page exists, no client component |
| `/settings` | Page exists, no client component |

---

## What Needs to Be Built

### Category A: New Route Pages (entirely missing)
These require new `app/(modules)/<name>/page.tsx` + `<name>-client.tsx` + dashboard config entry:

| # | Route | Maps To Report Section | Backend Tables |
|---|-------|----------------------|----------------|
| 1 | `/documents` | Document Management | DocumentFolder, Document, DocumentVersion, KnowledgeArticle |
| 2 | `/calendar` | Calendar & Scheduling | CalendarEvent, Activity, ProjectTask |
| 3 | `/messages` | Communication Hub | MailMessage, MailFollower, AuditLog (notifications) |
| 4 | `/reports` | Reporting & BI | FinancialReport, TrialBalance, BalanceSheetLine, ProfitLossLine |
| 5 | `/assets` | Asset Management | AccountAsset, AccountAssetDepreciationLine |
| 6 | `/workflows` | Workflow Automation | (workflow module tables) |
| 7 | `/helpdesk` | Support Tickets | (helpdesk module tables) |
| 8 | `/expenses` | Expense Reports | (expenses module tables) |
| 9 | `/subscriptions` | Subscription Billing | SubscriptionPlan, Subscription, SubscriptionLine |

### Category B: Existing Modules — Missing Tabs / Sub-Views
Add new tabs to existing module configs in `module-dashboard-configs.ts` and wire up client:

#### Accounting → Add tabs:
- **General Ledger** — AccountMove + AccountMoveLine (posted, full GL drill-down)
- **Bank Reconciliation** — AccountBankStatement, AccountBankStatementLine, BankMatchCandidate
- **Financial Statements** — FinancialReport, TrialBalance, BalanceSheetLine, ProfitLossLine, CashFlowLine
- **Fixed Assets** — AccountAsset, AccountAssetDepreciationLine (depreciation schedule widget)
- **Payment Terms** — AccountPaymentTerm, AccountPaymentTermLine

#### Sales → Add tabs:
- **Invoices** — AccountMove filtered by `move_type = "out_invoice"` (already partially in client)
- **Deliveries / Order Fulfillment** — StockPicking + StockPickingBatch
- **Contracts** — (map from SaleOrder with contract flag)
- **Returns / RMA** — StockPicking filtered by return type

#### CRM → Add tabs:
- **Campaigns** — UtmCampaign, UtmMedium, UtmSource
- **Segments** — ContactSegment, SegmentMember
- **Activities Calendar** — CalendarEvent filtered by org + user

#### Purchasing → Add tabs:
- **Vendor Management** — Contact filtered by `is_vendor = true`, ResPartnerBank
- **Receipts (3-way Match)** — StockPicking from purchase orders, PurchaseOrderLine vs received qty
- **Landed Costs** — StockLandedCost, StockLandedCostLines

#### Inventory → Add tabs:
- **Warehouse Locations** — StockLocation (bin management tree view)
- **Pick/Pack/Ship** — WarehouseTask, PickingWave (WMS workflow)
- **Cycle Counting** — StockCycleCount, StockCountSheet
- **Lot/Serial Tracking** — StockProductionLot, StockProductionSerial, Traceability
- **Quality Control** — QualityCheck, QualityAlert, QualityPoint
- **Replenishment Rules** — ReplenishmentRule, StockReorderGroup

#### Manufacturing → Add tabs:
- **Capacity Planning** — MrpWorkcenter + MrpWorkcenterProductivity (utilization chart)
- **Quality Checkpoints** — QualityPoint linked to work orders
- **BOM Explosion** — BomExplosionResult tree view

#### HR → Add tabs:
- **Org Chart** — HrDepartment + HrEmployee tree/graph visualization
- **Recruitment** — HrJobPosition filtered by state = "recruit"
- **Time & Attendance** — ProjectTimesheet filtered by employee
- **Payroll** — HrPayslip, HrPayrollStructure, HrSalaryRule

#### Projects → Add tabs:
- **Gantt Chart** — ProjectProject + ProjectTask with date ranges
- **Resource Allocation** — HrEmployee + ProjectTimesheet + capacity
- **Budget vs Actual** — ProjectProject (budget fields) vs ProjectTimesheet (cost)

### Category C: Stub Pages — Implement Client Components
| Route | Component to Create | Primary Tables |
|-------|--------------------|-|
| `/iot` | `iot-client.tsx` | IoT tables (devices, telemetry, alerts) |
| `/tasks` | `tasks-client.tsx` | ProjectTask (Kanban board across all projects) |
| `/settings` | `settings-client.tsx` | UserProfile, Role, CasbinRule, OrganizationSettings |

---

## Implementation Patterns

### File Structure for Each New Page
```
app/(modules)/<name>/
  page.tsx          ← Server component: fetch session + initial data
  <name>-client.tsx ← Client component: live subscriptions + mutations
```

### Dashboard Config Pattern (module-dashboard-configs.ts)
```typescript
export const <name>Dashboard: DashboardConfig = {
  id: "<name>",
  title: "<Title>",
  description: "<description>",
  sections: [
    // 1. Quick actions row (4 actions)
    // 2. KPI stat cards (4 metrics)
    // 3. Detail widgets (charts, summaries, tables)
  ]
}

export const <name>ModuleConfig: ModuleConfig = {
  id: "<name>",
  title: "<Title>",
  icon: "<lucide-icon>",
  tabs: [
    { id: "dashboard", label: "Dashboard", type: "dashboard", dashboard: <name>Dashboard },
    { id: "<entity>", label: "<Entity>", type: "table", tableConfig: <entity>TableConfig, formConfig: new<Entity>Form },
    // ...
  ]
}
```

### Client Component Pattern
```typescript
"use client"
// 1. Import ModuleView, FormModal, form configs from @lumiere/ui
// 2. Import use* hooks + mutation hooks from @lumiere/stdb
// 3. Import module config from @/lib/module-dashboard-configs
// 4. Subscribe to tables via hooks
// 5. Compute live KPI overrides (useMemo)
// 6. Handle quick action → FormModal mapping
// 7. Return <ModuleView> with live sections + <FormModal>
```

---

## Sidebar Navigation — New Items to Add

The modules layout sidebar needs to include new routes. Current nav items to reference:
- File: `app/(modules)/layout.tsx`

New nav entries needed:
```
Documents     → /documents    (icon: FolderOpen)
Calendar      → /calendar     (icon: Calendar)
Messages      → /messages     (icon: MessageSquare)
Reports       → /reports      (icon: BarChart2)
Assets        → /assets       (icon: Package)
Workflows     → /workflows    (icon: GitBranch)
Helpdesk      → /helpdesk     (icon: Headphones)
Expenses      → /expenses     (icon: Receipt)
Subscriptions → /subscriptions (icon: RefreshCw)
```

---

## UI Components Needed (from @lumiere/ui or new local components)

### New Table Configs (to add to @lumiere/ui or module-dashboard-configs.ts)
| Config Name | Primary Table | Used In |
|------------|---------------|---------|
| `documentsTableConfig` | Document | /documents |
| `documentFoldersTableConfig` | DocumentFolder | /documents |
| `knowledgeArticlesTableConfig` | KnowledgeArticle | /documents |
| `calendarEventsTableConfig` | CalendarEvent | /calendar |
| `assetsTableConfig` | AccountAsset | /assets |
| `assetDepreciationTableConfig` | AccountAssetDepreciationLine | /assets |
| `subscriptionsTableConfig` | Subscription | /subscriptions |
| `subscriptionPlansTableConfig` | SubscriptionPlan | /subscriptions |
| `expensesTableConfig` | (expense tables) | /expenses |
| `helpdeskTicketsTableConfig` | (helpdesk tables) | /helpdesk |
| `bankStatementsTableConfig` | AccountBankStatement | /accounting |
| `financialReportTableConfig` | FinancialReport | /accounting, /reports |
| `fixedAssetsTableConfig` | AccountAsset | /accounting, /assets |
| `warehouseLocationsTableConfig` | StockLocation | /inventory |
| `cycleCountTableConfig` | StockCycleCount | /inventory |
| `lotsTableConfig` | StockProductionLot | /inventory |
| `qualityChecksTableConfig` | QualityCheck | /inventory, /manufacturing |
| `workcenterCapacityTableConfig` | MrpWorkcenterProductivity | /manufacturing |
| `payslipsTableConfig` | HrPayslip | (already imported) |
| `jobPositionsTableConfig` | HrJobPosition | /hr |

### New Form Configs (to add to @lumiere/ui)
| Form Name | Creates |
|-----------|---------|
| `newDocumentForm` | Document upload |
| `newDocumentFolderForm` | DocumentFolder |
| `newKnowledgeArticleForm` | KnowledgeArticle |
| `newCalendarEventForm` | CalendarEvent |
| `newAssetForm` | AccountAsset |
| `newSubscriptionForm` | Subscription |
| `newSubscriptionPlanForm` | SubscriptionPlan |

### New Specialized Widget Types (beyond current stat-cards, charts, tables)
| Widget Type | Purpose | Used In |
|------------|---------|---------|
| `org-chart` | Hierarchical employee tree | /hr → Org Chart tab |
| `gantt-chart` | Timeline for tasks/projects | /projects → Gantt tab |
| `kanban-board` | Task card columns | /tasks |
| `file-browser` | Folder tree + file grid | /documents |
| `calendar-view` | Month/week/day calendar | /calendar |
| `bank-reconciliation` | Match statement lines | /accounting |
| `bom-tree` | Exploded BOM hierarchy | /manufacturing |
| `pipeline-board` | Opportunity stages | /crm |
| `capacity-chart` | Work center utilization bar | /manufacturing |

---

## Priority Order

### Phase 1 — High Priority (fills biggest gaps)
1. **Documents** (`/documents`) — DocumentFolder, Document, KnowledgeArticle
2. **Reports** (`/reports`) — FinancialReport, TrialBalance, P&L, Balance Sheet, Cash Flow
3. **Assets** (`/assets`) — AccountAsset, depreciation schedule
4. **Tasks** (`/tasks`) — Implement kanban client component
5. **Settings** (`/settings`) — Users, roles, org settings client component
6. **Accounting** — Add Bank Reconciliation, GL, Financial Statements tabs

### Phase 2 — Medium Priority
7. **Calendar** (`/calendar`) — CalendarEvent + Activity scheduler
8. **Subscriptions** (`/subscriptions`) — Recurring billing management
9. **Expenses** (`/expenses`) — Employee expense reports
10. **HR** — Add Org Chart, Recruitment, Payroll tabs
11. **Inventory** — Add Cycle Counting, Lot/Serial, WMS tabs
12. **Sales** — Add Invoices, Deliveries, Returns tabs

### Phase 3 — Lower Priority
13. **Messages** (`/messages`) — Internal messaging hub
14. **Helpdesk** (`/helpdesk`) — Support ticket management
15. **Workflows** (`/workflows`) — Visual workflow designer
16. **IoT** (`/iot`) — Implement iot-client.tsx
17. **Projects** — Add Gantt, Resource Allocation tabs
18. **CRM** — Add Campaigns, Segments tabs
19. **Manufacturing** — Add Capacity Planning, Quality tabs
20. **Purchasing** — Add Vendor Management, 3-way Match tabs

---

## Key Files to Modify

| File | Change |
|------|--------|
| `frontend/web/lib/module-dashboard-configs.ts` | Add new module configs for all new pages + new tabs to existing modules |
| `frontend/web/app/(modules)/layout.tsx` | Add sidebar nav items for new routes |
| `frontend/web/app/(modules)/accounting/accounting-client.tsx` | Add bank reconciliation, GL, financial statements tabs |
| `frontend/web/app/(modules)/hr/hr-client.tsx` | Add org chart, recruitment, payroll tabs |
| `frontend/web/app/(modules)/inventory/inventory-client.tsx` | Add WMS, cycle count, lot/serial tabs |
| `frontend/web/app/(modules)/sales/sales-client.tsx` | Add invoices, deliveries, returns tabs |
| `frontend/web/app/(modules)/projects/projects-client.tsx` | Add Gantt, resource allocation tabs |

## New Files to Create

| File | Description |
|------|-------------|
| `app/(modules)/documents/page.tsx` | Server component |
| `app/(modules)/documents/documents-client.tsx` | Client component |
| `app/(modules)/calendar/page.tsx` | Server component |
| `app/(modules)/calendar/calendar-client.tsx` | Client component |
| `app/(modules)/reports/page.tsx` | Server component |
| `app/(modules)/reports/reports-client.tsx` | Client component |
| `app/(modules)/assets/page.tsx` | Server component |
| `app/(modules)/assets/assets-client.tsx` | Client component |
| `app/(modules)/subscriptions/page.tsx` | Server component |
| `app/(modules)/subscriptions/subscriptions-client.tsx` | Client component |
| `app/(modules)/expenses/page.tsx` | Server component |
| `app/(modules)/expenses/expenses-client.tsx` | Client component |
| `app/(modules)/helpdesk/page.tsx` | Server component |
| `app/(modules)/helpdesk/helpdesk-client.tsx` | Client component |
| `app/(modules)/workflows/page.tsx` | Server component |
| `app/(modules)/workflows/workflows-client.tsx` | Client component |
| `app/(modules)/messages/page.tsx` | Server component |
| `app/(modules)/messages/messages-client.tsx` | Client component |
| `app/(modules)/tasks/tasks-client.tsx` | Client (page.tsx exists) |
| `app/(modules)/iot/iot-client.tsx` | Client (page.tsx exists) |
| `app/(modules)/settings/settings-client.tsx` | Client (page.tsx exists) |

---

## Verification

For each new page:
1. Navigate to the route in browser — page renders without error
2. Dashboard tab shows KPI stat cards with placeholder or live data
3. Entity tabs render data tables
4. Quick action buttons open FormModal
5. RBAC gates work (restricted users cannot see/use actions)
6. `spacetime logs <db-name>` shows no reducer errors after form submissions
