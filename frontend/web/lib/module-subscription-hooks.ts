"use client"

import { useModuleSubscription } from "@lumiere/stdb/live"
import {
  ACCOUNTING_WORKSPACE_RESOURCE_KEYS,
  CALENDAR_WORKSPACE_RESOURCE_KEYS,
  CRM_WORKSPACE_RESOURCE_KEYS,
  DOCUMENTS_WORKSPACE_RESOURCE_KEYS,
  EXPENSES_WORKSPACE_RESOURCE_KEYS,
  HELPDESK_WORKSPACE_RESOURCE_KEYS,
  HR_WORKSPACE_RESOURCE_KEYS,
  INVENTORY_WORKSPACE_RESOURCE_KEYS,
  IOT_WORKSPACE_RESOURCE_KEYS,
  MANUFACTURING_WORKSPACE_RESOURCE_KEYS,
  MESSAGES_WORKSPACE_RESOURCE_KEYS,
  POS_WORKSPACE_RESOURCE_KEYS,
  PROJECTS_WORKSPACE_RESOURCE_KEYS,
  PROPOSALS_WORKSPACE_RESOURCE_KEYS,
  PURCHASING_WORKSPACE_RESOURCE_KEYS,
  REPORTS_WORKSPACE_RESOURCE_KEYS,
  SALES_WORKSPACE_RESOURCE_KEYS,
  SETTINGS_WORKSPACE_RESOURCE_KEYS,
  SUBSCRIPTIONS_WORKSPACE_RESOURCE_KEYS,
  WORKFLOWS_WORKSPACE_RESOURCE_KEYS,
  AI_AGENTS_WORKSPACE_RESOURCE_KEYS,
  FLEET_WORKSPACE_RESOURCE_KEYS,
} from "@lumiere/stdb/subscriptions"

/** Dashboard cards pull from several modules — subscribe on overview visit only. */
const OVERVIEW_WORKSPACE_RESOURCE_KEYS = [
  "sale-orders",
  "account-moves",
  "stock-quants",
  "products",
  "purchase-orders",
  "tasks",
  "projects",
  "contacts",
  "payment-transactions",
  "payment-reconciliations",
  "message-batches",
] as const

const MAP_WORKSPACE_RESOURCE_KEYS = [
  ...FLEET_WORKSPACE_RESOURCE_KEYS,
  ...POS_WORKSPACE_RESOURCE_KEYS,
  "warehouses",
] as const

export function useCrmModuleSubscription(): void {
  useModuleSubscription(CRM_WORKSPACE_RESOURCE_KEYS)
}

export function useAccountingModuleSubscription(): void {
  useModuleSubscription(ACCOUNTING_WORKSPACE_RESOURCE_KEYS)
}

export function useSalesModuleSubscription(): void {
  useModuleSubscription(SALES_WORKSPACE_RESOURCE_KEYS)
}

export function useInventoryModuleSubscription(): void {
  useModuleSubscription(INVENTORY_WORKSPACE_RESOURCE_KEYS)
}

export function useManufacturingModuleSubscription(): void {
  useModuleSubscription(MANUFACTURING_WORKSPACE_RESOURCE_KEYS)
}

export function useHrModuleSubscription(): void {
  useModuleSubscription(HR_WORKSPACE_RESOURCE_KEYS)
}

export function usePurchasingModuleSubscription(): void {
  useModuleSubscription(PURCHASING_WORKSPACE_RESOURCE_KEYS)
}

export function useDocumentsModuleSubscription(): void {
  useModuleSubscription(DOCUMENTS_WORKSPACE_RESOURCE_KEYS)
}

export function useReportsModuleSubscription(): void {
  useModuleSubscription(REPORTS_WORKSPACE_RESOURCE_KEYS)
}

export function useSettingsModuleSubscription(): void {
  useModuleSubscription(SETTINGS_WORKSPACE_RESOURCE_KEYS)
}

export function useSubscriptionsModuleSubscription(): void {
  useModuleSubscription(SUBSCRIPTIONS_WORKSPACE_RESOURCE_KEYS)
}

export function useProposalsModuleSubscription(): void {
  useModuleSubscription(PROPOSALS_WORKSPACE_RESOURCE_KEYS)
}

export function useProjectsModuleSubscription(): void {
  useModuleSubscription(PROJECTS_WORKSPACE_RESOURCE_KEYS)
}

export function useHelpdeskModuleSubscription(): void {
  useModuleSubscription(HELPDESK_WORKSPACE_RESOURCE_KEYS)
}

export function useWorkflowsModuleSubscription(): void {
  useModuleSubscription(WORKFLOWS_WORKSPACE_RESOURCE_KEYS)
}

export function useExpensesModuleSubscription(): void {
  useModuleSubscription(EXPENSES_WORKSPACE_RESOURCE_KEYS)
}

export function useCalendarModuleSubscription(): void {
  useModuleSubscription(CALENDAR_WORKSPACE_RESOURCE_KEYS)
}

export function useMessagesModuleSubscription(): void {
  useModuleSubscription(MESSAGES_WORKSPACE_RESOURCE_KEYS)
}

export function useIotModuleSubscription(): void {
  useModuleSubscription(IOT_WORKSPACE_RESOURCE_KEYS)
}

export function usePosModuleSubscription(): void {
  useModuleSubscription(POS_WORKSPACE_RESOURCE_KEYS)
}

export function useAiAgentsModuleSubscription(): void {
  useModuleSubscription(AI_AGENTS_WORKSPACE_RESOURCE_KEYS)
}

export function useOverviewModuleSubscription(): void {
  useModuleSubscription(OVERVIEW_WORKSPACE_RESOURCE_KEYS)
}

export function useMapModuleSubscription(): void {
  useModuleSubscription(MAP_WORKSPACE_RESOURCE_KEYS)
}
