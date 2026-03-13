# Accounting UI — Implementation Plan

## Overview

Wire up the SpacetimeDB accounting module end-to-end:
**stdb subscriptions → live React hooks → TanStack routes → @lumiere/ui screens**

Screens use the full `@lumiere/ui` modular component suite:
- **`EntityView`** (`entity-views/`) — config-driven table + detail views for all accounting entities
- **`ModularForm`** (`forms/`) — config-driven create/edit forms wired to stdb reducers
- **Accounting Widgets** — purpose-built KPI, chart, and metric widgets for the overview dashboard
- **Quick Actions** — context-aware action buttons (toolbar + row-level) using `EntityAction`

---

## Architecture

```
stdb.ts              ← add accounting table subscriptions
@lumiere/stdb        ← add 5 accounting hooks
@lumiere/i18n        ← add accounting translation keys
web/routes/          ← new /accounting/* file-based routes
@lumiere/ui          ← EntityView + ModularForm + Widgets + Actions
```

---

## Step 1: Infrastructure Wiring

### 1a. Add `@lumiere/ui` to web
- `frontend/web/package.json` — add `"@lumiere/ui": "workspace:*"`
- `frontend/web/src/styles.css` — add `@import "@lumiere/ui/globals.css";` at top

### 1b. Wire providers in root layout
- `frontend/web/src/routes/__root.tsx` — wrap children with `<I18nProvider>` from `@lumiere/i18n` and `<ThemeProvider>` from `@lumiere/ui`

### 1c. Extend SpacetimeDB subscriptions
- `frontend/web/src/lib/stdb.ts` — add to `subscribe([...])`:
  ```ts
  "SELECT * FROM account_account",
  "SELECT * FROM account_journal",
  "SELECT * FROM account_move",
  "SELECT * FROM account_move_line",
  "SELECT * FROM account_tax",
  "SELECT * FROM account_analytic_account",
  "SELECT * FROM crossovered_budget",
  "SELECT * FROM crossovered_budget_lines",
  ```

### 1d. Add accounting i18n keys
- `frontend/packages/i18n/src/locales/en.json` — add `"accounting"` namespace:
  ```json
  "accounting": {
    "title": "Accounting",
    "accounts": {
      "title": "Chart of Accounts",
      "code": "Code", "name": "Name", "type": "Type",
      "balance": "Balance", "active": "Active"
    },
    "journalEntries": {
      "title": "Journal Entries",
      "ref": "Reference", "date": "Date", "journal": "Journal",
      "state": "Status", "total": "Total"
    },
    "invoices": {
      "title": "Invoices", "ar": "Customer Invoices", "ap": "Vendor Bills",
      "dueDate": "Due Date", "paymentState": "Payment", "partner": "Partner"
    },
    "taxes": {
      "title": "Taxes", "rate": "Rate", "taxUse": "Type", "priceInclude": "Price Inc."
    },
    "budgets": {
      "title": "Budgets", "planned": "Planned", "practical": "Actual", "variance": "Variance %"
    },
    "states": {
      "draft": "Draft", "posted": "Posted", "cancelled": "Cancelled",
      "paid": "Paid", "partial": "Partial", "notPaid": "Unpaid"
    }
  }
  ```

### 1e. Shared constants
- `frontend/web/src/lib/constants.ts` (new) — `export const DEFAULT_COMPANY_ID = 1n`
  (placeholder until auth context is wired)

---

## Step 2: STDB Hooks

New files in `frontend/packages/stdb/src/hooks/`, following the `useIotHubs.ts` pattern
(`useReducer` + `onInsert`/`onUpdate` callbacks, stub-ready until `spacetime generate` runs).

| File | Signature |
|------|-----------|
| `useAccountAccounts.ts` | `useAccountAccounts(companyId: bigint): AccountAccount[]` |
| `useAccountMoves.ts` | `useAccountMoves(companyId: bigint, moveType?: string): AccountMove[]` |
| `useAccountJournals.ts` | `useAccountJournals(companyId: bigint): AccountJournal[]` |
| `useAccountTaxes.ts` | `useAccountTaxes(companyId: bigint): AccountTax[]` |
| `useBudgets.ts` | `useBudgets(companyId: bigint): CrossoveredBudget[]` |

Update `frontend/packages/stdb/src/index.ts` to re-export all 5 new hooks.

---

## Step 3: Routes

### Layout — `src/routes/accounting.tsx`
Mirrors `iot.tsx`: `useStdb()` connection guard → two-panel layout:
- Left: `<AccountingSidebar>` (`src/components/AccountingSidebar.tsx`)
- Right: `<Outlet />`

**AccountingSidebar nav links:**
| Label | Route |
|-------|-------|
| Overview | `/accounting` |
| Chart of Accounts | `/accounting/accounts` |
| Journal Entries | `/accounting/journal-entries` |
| Customer Invoices | `/accounting/invoices/ar` |
| Vendor Bills | `/accounting/invoices/ap` |
| Taxes | `/accounting/taxes` |
| Budgets | `/accounting/budgets` |

### Overview — `src/routes/accounting/index.tsx`
`DashboardHeader` + `DashboardGrid` + **accounting-specific widgets** (see Step 4).

Live KPIs derived from stdb hooks:
| KPI Widget | Source |
|------------|--------|
| Total GL Accounts | `useAccountAccounts(companyId).length` |
| Open Invoices (count + total AR) | moves where `paymentState !== "paid"` |
| Draft Entries | moves where `state === "draft"` |
| Budget Variance % | latest budget's `variancePercentage` |
| Overdue Invoices | moves where `invoiceDateDue < today && paymentState !== "paid"` |
| Tax Deadlines | upcoming `TaxDeadline` entries (from future hook) |

**Quick actions on overview** (top-right of header):
- `+ New Invoice` → opens `FormModal` with `newInvoiceForm` config
- `+ New Journal Entry` → opens `FormModal` with `newJournalEntryForm` config

---

### Chart of Accounts — `src/routes/accounting/accounts.tsx`
- Hook: `useAccountAccounts(companyId)`
- Component: `<EntityView config={accountsTableConfig} data={accounts} />`
- Uses pre-built config from `demo-entity-configs.ts` (search + group/status filter built-in)
- **Row-level quick actions** via `EntityAction` in config:
  - `View` → navigate to `/accounting/accounts/$id`
- **Toolbar dedicated button**: `+ New Account` → `FormModal` with `newAccountForm` config
- Detail route `/accounting/accounts/$id` → `<EntityView config={accountDetailConfig} record={account} />`

### Journal Entries — `src/routes/accounting/journal-entries.tsx`
- Hook: `useAccountMoves(companyId)`
- Component: `<EntityView config={journalEntriesTableConfig} data={moves} />`
- Config already has status + type filters from `demo-entity-configs.ts`
- **Toolbar dedicated buttons**:
  - `+ New Entry` → `FormModal` with `newJournalEntryForm` config
- **Row quick actions** (selection-based):
  - `Post` (requires selection, calls `post_account_move` reducer)
  - `Cancel` (requires selection, calls `cancel_account_move` reducer)
- Row click → `/accounting/journal-entries/$id` detail view

### Customer Invoices — `src/routes/accounting/invoices/ar.tsx`
- Hook: `useAccountMoves(companyId, "out_invoice")`
- Component: `<EntityView config={journalEntriesTableConfig} data={arMoves} />`
- **Toolbar dedicated button**: `+ New Invoice` → `FormModal` with `newInvoiceForm` config
- **Row quick actions** (selection-based):
  - `Post Invoice` → calls `post_invoice` reducer
  - `Register Payment` → `FormModal` with `registerPaymentForm` config (future)
- Row click → `/accounting/invoices/ar/$id` → `<EntityView config={invoiceDetailConfig} record={invoice} />`

### Vendor Bills — `src/routes/accounting/invoices/ap.tsx`
- Hook: `useAccountMoves(companyId, "in_invoice")`
- Same pattern as AR — dedicated `+ New Bill` button
- Row quick actions: `Post Bill`, `Register Payment`

### Taxes — `src/routes/accounting/taxes.tsx`
- Hook: `useAccountTaxes(companyId)`
- Component: `<EntityView config={taxesTableConfig} data={taxes} />`
- **Toolbar dedicated button**: `+ New Tax` → `FormModal` with `newTaxForm` config

### Budgets — `src/routes/accounting/budgets.tsx`
- Hook: `useBudgets(companyId)`
- Component: `<EntityView config={budgetsTableConfig} data={budgets} />`
- **Toolbar dedicated button**: `+ New Budget` → `FormModal` with `newBudgetForm` config

---

## Step 4: Accounting Widgets (new in `@lumiere/ui`)

New widget files in `packages/ui/src/pages/widgets/` — purpose-built for accounting UX, plugged into the `DashboardGrid` via the existing widget system.

### `overdue-invoices-widget.tsx`
- Type: `"overdue-invoices"` (new widget type in `DashboardWidget`)
- Shows: count of overdue invoices + total amount overdue
- Visual: red/amber accent, amount prominently displayed, sparkline trend
- Data: `{ count: number; totalAmount: number; oldestDays: number }`

### `cash-flow-widget.tsx`
- Type: `"cash-flow"`
- Shows: AR total vs AP total as a side-by-side bar or donut
- Data: `{ arTotal: number; apTotal: number; netPosition: number }`

### `budget-progress-widget.tsx`
- Type: `"budget-progress"`
- Shows: list of budgets with progress bars (planned vs actual), variance % with color coding
- Green ≤ 90%, amber 90–100%, red > 100% of planned
- Data: `{ budgets: Array<{ name: string; planned: number; actual: number; variance: number }> }`

### `tax-deadline-widget.tsx`
- Type: `"tax-deadline"`
- Shows: upcoming tax deadlines as a timeline/list with days-remaining pill
- Status colors: upcoming (blue), due-soon (amber), overdue (red)
- Data: `{ deadlines: Array<{ title: string; dueDate: string; status: string; daysUntil: number }> }`

### `account-balance-widget.tsx`
- Type: `"account-balance"`
- Shows: configurable list of key accounts with their balances (e.g. cash, AR, AP)
- Data: `{ accounts: Array<{ code: string; name: string; balance: number; type: string }> }`

**Register new widget types** in `dashboard-widget-renderer.tsx`:
```tsx
case "overdue-invoices": return <OverdueInvoicesWidget data={widget.data} />
case "cash-flow":        return <CashFlowWidget data={widget.data} />
case "budget-progress":  return <BudgetProgressWidget data={widget.data} />
case "tax-deadline":     return <TaxDeadlineWidget data={widget.data} />
case "account-balance":  return <AccountBalanceWidget data={widget.data} />
```

**Add accounting dashboard config** to `demo-dashboard-config.ts`:
```ts
export function createAccountingDashboard(t: T): DashboardConfig
// Uses new widget types for accounting overview page
```

---

## Step 5: Accounting Forms (ModularForm configs)

New file: `packages/ui/src/lib/demo-accounting-form-configs.ts`
Mirrors `demo-form-configs.ts` pattern — static `FormConfig` objects consumed by `ModularForm` / `FormModal`.

| Config | Key Fields | Reducer |
|--------|-----------|---------|
| `newInvoiceForm` | Partner, Invoice Date, Due Date, Journal, Lines (product/qty/price), Notes | `create_account_move` |
| `newJournalEntryForm` | Date, Journal, Reference, Lines (account/debit/credit), Notes | `create_account_move` |
| `newAccountForm` | Code, Name, Account Type, Internal Group, Reconcile, Tags | `create_account_account` |
| `newTaxForm` | Name, Tax Type, Amount Type, Amount %, Price Include, Tax Group | `create_account_tax` |
| `newBudgetForm` | Name, Date From, Date To, Description | `create_crossovered_budget` |
| `postMoveForm` | (confirmation only — move name + date confirmation) | `post_account_move` |

Each form is opened via `<FormModal config={newInvoiceForm} open={open} onSubmit={handleSubmit} />` where `handleSubmit` calls the appropriate stdb reducer via `getStdb().reducers.xxx(...)`.

---

## Step 6: Badge Variants (via EntityView + demo-entity-configs)

Already handled inside `demo-entity-configs.ts` `badgeVariants` / `badgeLabels` maps — no manual Badge code needed in routes.

```
draft      → secondary   | posted     → default
cancel     → destructive | not_paid   → destructive
partial    → outline     | paid       → default
```

---

## Full File List

### New files (26)
```
# STDB hooks
packages/stdb/src/hooks/useAccountAccounts.ts
packages/stdb/src/hooks/useAccountMoves.ts
packages/stdb/src/hooks/useAccountJournals.ts
packages/stdb/src/hooks/useAccountTaxes.ts
packages/stdb/src/hooks/useBudgets.ts

# Accounting form configs
packages/ui/src/lib/demo-accounting-form-configs.ts

# Accounting widgets
packages/ui/src/pages/widgets/overdue-invoices-widget.tsx
packages/ui/src/pages/widgets/cash-flow-widget.tsx
packages/ui/src/pages/widgets/budget-progress-widget.tsx
packages/ui/src/pages/widgets/tax-deadline-widget.tsx
packages/ui/src/pages/widgets/account-balance-widget.tsx

# Web app
web/src/lib/constants.ts
web/src/components/AccountingSidebar.tsx
web/src/routes/accounting.tsx
web/src/routes/accounting/index.tsx
web/src/routes/accounting/accounts.tsx
web/src/routes/accounting/accounts.$id.tsx        ← detail view
web/src/routes/accounting/journal-entries.tsx
web/src/routes/accounting/journal-entries.$id.tsx ← detail view
web/src/routes/accounting/invoices/ar.tsx
web/src/routes/accounting/invoices/ar.$id.tsx     ← detail view
web/src/routes/accounting/invoices/ap.tsx
web/src/routes/accounting/invoices/ap.$id.tsx     ← detail view
web/src/routes/accounting/taxes.tsx
web/src/routes/accounting/budgets.tsx
```

### Modified files (8)
```
web/package.json                                  add @lumiere/ui workspace dep
web/src/styles.css                                import @lumiere/ui/globals.css
web/src/routes/__root.tsx                         add I18nProvider + ThemeProvider
web/src/lib/stdb.ts                               add 8 accounting subscriptions
packages/stdb/src/index.ts                        re-export 5 new hooks
packages/i18n/src/locales/en.json                 add accounting namespace
packages/ui/src/pages/dashboard-widget-renderer.tsx  register 5 new widget types
packages/ui/src/lib/dashboard-types.ts            add 5 new WidgetType values
```

---

## Verification

```bash
pnpm install                              # link @lumiere/ui into web
pnpm -F web dev                           # dev server at :3000
# → /accounting                  connection guard → layout + sidebar
# → /accounting/accounts         EntityView table with search/filter
# → /accounting/accounts/$id     EntityView detail
# → /accounting/journal-entries  table + Post/Cancel quick actions
# → /accounting/invoices/ar      AR table + New Invoice button → FormModal
pnpm -F @lumiere/stdb typecheck          # hook types pass
pnpm -F @lumiere/i18n typecheck          # translation keys pass
pnpm -F @lumiere/ui typecheck            # widget + form types pass
```
