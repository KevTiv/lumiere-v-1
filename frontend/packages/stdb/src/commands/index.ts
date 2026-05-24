/**
 * Named reducer wrappers — only stable imports from `@lumiere/stdb/commands`.
 * Implementation may import generated bindings internally.
 */
export type { ReducerCommandContractMeta } from "./types";
export {
  callEnsureDevAdmin,
  ensureDevAdminContract,
  normalizeEnsureDevAdminInput,
  type EnsureDevAdminInput,
} from "./core";
export {
  CRM_BFF_REDUCERS,
  CRM_COMMAND_SUBSCRIPTION_HINTS,
  crmBffCallUrl,
  crmBffPost,
  crmCommandContract,
  type CrmBffReducerKey,
} from "./crm-http";
export {
  ACCOUNTING_BFF_REDUCERS,
  ACCOUNTING_COMMAND_SUBSCRIPTION_HINTS,
  accountingBffCallUrl,
  accountingBffPost,
  accountingCommandContract,
  type AccountingBffReducerKey,
} from "./accounting-http";
export {
  SALES_BFF_REDUCERS,
  SALES_COMMAND_SUBSCRIPTION_HINTS,
  salesBffCallUrl,
  salesBffPost,
  salesCommandContract,
  type SalesBffReducerKey,
} from "./sales-http";
export {
  PROPOSALS_BFF_REDUCERS,
  PROPOSALS_COMMAND_SUBSCRIPTION_HINTS,
  proposalsBffCallUrl,
  proposalsBffPost,
  proposalsCommandContract,
  type ProposalsBffReducerKey,
} from "./proposals-http";
export {
  INVENTORY_BFF_REDUCERS,
  INVENTORY_COMMAND_SUBSCRIPTION_HINTS,
  inventoryBffCallUrl,
  inventoryBffPost,
  inventoryCommandContract,
  type InventoryBffReducerKey,
} from "./inventory-http";
export {
  MANUFACTURING_BFF_REDUCERS,
  MANUFACTURING_COMMAND_SUBSCRIPTION_HINTS,
  manufacturingBffCallUrl,
  manufacturingBffPost,
  manufacturingCommandContract,
  type ManufacturingBffReducerKey,
} from "./manufacturing-http";
export {
  EXPENSES_BFF_REDUCERS,
  EXPENSES_COMMAND_SUBSCRIPTION_HINTS,
  expensesBffCallUrl,
  expensesBffPost,
  expensesCommandContract,
  type ExpensesBffReducerKey,
} from "./expenses-http";
export {
  FLEET_BFF_REDUCERS,
  FLEET_COMMAND_SUBSCRIPTION_HINTS,
  fleetBffCallUrl,
  fleetBffPost,
  fleetCommandContract,
  type FleetBffReducerKey,
} from "./fleet-http";
export {
  CALENDAR_BFF_REDUCERS,
  CALENDAR_COMMAND_SUBSCRIPTION_HINTS,
  calendarBffCallUrl,
  calendarBffPost,
  calendarCommandContract,
  type CalendarBffReducerKey,
} from "./calendar-http";
export {
  MESSAGES_BFF_REDUCERS,
  MESSAGES_COMMAND_SUBSCRIPTION_HINTS,
  messagesBffCallUrl,
  messagesBffPost,
  messagesCommandContract,
  type MessagesBffReducerKey,
} from "./messages-http";
export {
  AUTH_BFF_REDUCERS,
  AUTH_COMMAND_SUBSCRIPTION_HINTS,
  authBffCallUrl,
  authBffPost,
  authCommandContract,
  type AuthBffReducerKey,
} from "./auth-http";
export {
  PURCHASING_BFF_REDUCERS,
  PURCHASING_COMMAND_SUBSCRIPTION_HINTS,
  purchasingBffCallUrl,
  purchasingBffPost,
  purchasingCommandContract,
  type PurchasingBffReducerKey,
} from "./purchasing-http";
export {
  REPORTS_BFF_REDUCERS,
  REPORTS_COMMAND_SUBSCRIPTION_HINTS,
  reportsBffCallUrl,
  reportsBffPost,
  reportsCommandContract,
  type ReportsBffReducerKey,
} from "./reports-http";
export {
  HR_BFF_REDUCERS,
  HR_COMMAND_SUBSCRIPTION_HINTS,
  hrBffCallUrl,
  hrBffPost,
  hrCommandContract,
  type HrBffReducerKey,
} from "./hr-http";
export {
  IOT_BFF_REDUCERS,
  IOT_COMMAND_SUBSCRIPTION_HINTS,
  iotBffCallUrl,
  iotBffPost,
  iotCommandContract,
  type IotBffReducerKey,
} from "./iot-http";
export {
  PROJECTS_BFF_REDUCERS,
  PROJECTS_COMMAND_SUBSCRIPTION_HINTS,
  projectsBffCallUrl,
  projectsBffPost,
  projectsCommandContract,
  type ProjectsBffReducerKey,
} from "./projects-http";
export {
  SUBSCRIPTIONS_BFF_REDUCERS,
  SUBSCRIPTIONS_COMMAND_SUBSCRIPTION_HINTS,
  subscriptionsBffCallUrl,
  subscriptionsBffPost,
  subscriptionsCommandContract,
  type SubscriptionsBffReducerKey,
} from "./subscriptions-http";
export {
  WORKFLOWS_BFF_REDUCERS,
  WORKFLOWS_COMMAND_SUBSCRIPTION_HINTS,
  workflowsBffCallUrl,
  workflowsBffPost,
  workflowsCommandContract,
  type WorkflowsBffReducerKey,
} from "./workflows-http";
export {
  DOCUMENTS_BFF_REDUCERS,
  DOCUMENTS_COMMAND_SUBSCRIPTION_HINTS,
  documentsBffCallUrl,
  documentsBffPost,
  documentsCommandContract,
  type DocumentsBffReducerKey,
} from "./documents-http";
export {
  POS_BFF_REDUCERS,
  POS_COMMAND_SUBSCRIPTION_HINTS,
  posBffCallUrl,
  posBffPost,
  posCommandContract,
  type PosBffReducerKey,
} from "./pos-http";
export {
  HELPDESK_BFF_REDUCERS,
  HELPDESK_COMMAND_SUBSCRIPTION_HINTS,
  helpdeskBffCallUrl,
  helpdeskBffPost,
  helpdeskCommandContract,
  type HelpdeskBffReducerKey,
} from "./helpdesk-http";
export {
  AI_AGENTS_BFF_REDUCERS,
  AI_AGENTS_COMMAND_SUBSCRIPTION_HINTS,
  aiAgentsBffCallUrl,
  aiAgentsBffPost,
  aiAgentsCommandContract,
  type AiAgentsBffReducerKey,
} from "./ai-agents-http";
export {
  ORGANIZATION_COMPANY_BFF_REDUCERS,
  ORGANIZATION_COMPANY_COMMAND_SUBSCRIPTION_HINTS,
  organizationCompanyBffCallUrl,
  organizationCompanyBffPost,
  organizationCompanyCommandContract,
  type OrganizationCompanyBffReducerKey,
} from "./organization-company-http";
export {
  ORG_MASTER_CSV_IMPORTS_BFF_REDUCERS,
  ORG_MASTER_CSV_IMPORTS_COMMAND_SUBSCRIPTION_HINTS,
  orgMasterCsvImportsBffCallUrl,
  orgMasterCsvImportsBffPost,
  orgMasterCsvImportsCommandContract,
  type OrgMasterCsvImportsBffReducerKey,
} from "./org-master-csv-imports-http";
export {
  SETTINGS_BFF_REDUCERS,
  SETTINGS_COMMAND_SUBSCRIPTION_HINTS,
  settingsBffCallUrl,
  settingsBffPost,
  settingsCommandContract,
  type SettingsBffReducerKey,
} from "./settings-http";
export {
  STDB_BFF_REDUCERS,
  stdbBffCallUrl,
  stdbBffPost,
  stdbCommandContract,
  type StdbBffReducerKey,
} from "./stdb-http";
