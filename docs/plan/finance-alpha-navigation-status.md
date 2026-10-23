# Finance Alpha navigation

## Scope

This change is a UI discovery profile based on `codex/finance-workflow-tools` (PR #242). The web module shell selects `finance-alpha`. Shared UI consumers without that provider retain the full catalog.

Visible Finance modules: Accounting, Sales, CRM, Purchasing, Reports, Subscriptions, Expenses.

Visible support: Overview, Tasks, Approvals, Documents, Calendar, Messages, Settings. Existing Journal, Notebook, and ERP Assistant panels remain available. Standalone AI, operations, workforce, project, proposal, and device module entries are hidden from global navigation.

The sidebar and command palette use the same filtered navigation catalog. Record search derives its permitted models from that catalog and existing read permissions. Empty navigation groups are removed.

## Supporting Settings

Profile/preferences, company and country/currency setup, users, roles, SSO, audit, and document/message integrations retain their existing role gates. Form configuration and custom-field target pickers show Finance modules plus Documents, Calendar, and Journal. The runtime form registry remains complete.

The guided import picker retains contacts/vendors, leads/opportunities, products, sales and purchase orders/lines, supplier information, ledger accounts/entries, tax rates, budgets, employee/department reference data, expenses, and subscriptions. Stock quantities, warehouses/locations/lots, projects/tasks/timesheets, payroll/leave/contracts, Helpdesk, and Manufacturing imports are hidden there. The AI-agent import and AI-chat archive action are hidden.

Finance workflows retain their own forms, record choices, and direct links to related receipts, products, employees, projects, and other records. Import APIs and in-module import tools remain unchanged.

## Overview

Global stock-alert and time-entry entry points are hidden. Project progress is omitted; task and deadline links go to the supporting Tasks workspace. Notes and Calendar remain available. Other module dashboards and linked Project workflows retain their existing productivity sections.

## Access boundaries

This profile does not authorize a route or operation. It intersects with the existing first-test-organization exposure policy; it cannot admit a denied surface. No route guard, RBAC rule, server query policy, mutation, generated contract, or business workflow was changed. Existing destination permissions still apply when following a Finance handoff or direct URL.

## Verification

- Production Next.js build passed against the isolated local Finance stack.
- Shared UI and web TypeScript checks passed.
- 26 focused UI tests passed: catalog/profile intersection, complete runtime forms, command-search model gating, Settings exposure, and active/tenant-scoped custom-field targets in both profiles.
- Five authenticated browser cases plus sign-in setup passed: expanded/collapsed navigation and palette at 1440px/390px, supporting Settings/import/form catalogs, Overview discovery, and the existing PO-owned receipt link into Inventory with exact focus after reload and Back.
- Three existing Overview/Documents smoke cases plus their sign-in setup passed after aligning the stock-link assertion with the Finance profile.
- Translation, immutable browser-operation transport, opaque-record ratchet, and whitespace checks passed.

The first receipt browser assertion matched both a visible and a hidden Next.js cached tab. The final assertion scopes the visible module and still requires the exact receipt URL, selected tab, single row, and ID filter.

CI remains a separate exact-head gate. No live Alpha deployment or data changes were made. This is navigation containment, not module certification.

## Current-main integration

Integrated main `68af4d68` and retargeted #243 to main after #242 merged. The command palette now keeps its title and description inside the portalled dialog content, so modal accessibility isolation preserves its name. A shared UI regression asserts that the open dialog contains its named heading and exposes its description.

The 390px navigation scenario opens the real mobile drawer by keyboard before inspecting Finance links, verifies its close action, and reopens it after the palette and route navigation. Desktop coverage retains the collapsed-sidebar checks. Visibility, permission, exact receipt handoff and no-business-write assertions remain enforced.

Local validation: all 928 shared UI tests across 142 files pass, including the title regression (which fails with the old placement). UI and web TypeScript and changed UI lint pass; Playwright discovers all five Finance navigation cases plus authentication setup. Full release E2E and fresh security checks are selected for the pushed head. The flagged Compose placeholder file is byte-for-byte identical to main; no scanner suppression or credential change was introduced.

## Module work boards

The supporting Tasks entry now opens My work. Purchasing, Sales, Accounting and Expenses include a scoped Work workspace, with a Finance aggregate over authorized assignments. Project-task and deadline links retain the existing project-task view through `source=projects`. Record follow-ups use the existing typed Activity targets where available. See [Module work boards for the Finance alpha](module-work-boards-alpha.md) for the source/action mapping, authorization boundaries and release checks.
