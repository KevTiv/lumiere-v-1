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
  crmCommandContract,
  type CrmBffReducerKey,
} from "./crm-http";
export {
  ACCOUNTING_BFF_REDUCERS,
  ACCOUNTING_COMMAND_SUBSCRIPTION_HINTS,
  accountingCommandContract,
  type AccountingBffReducerKey,
} from "./accounting-http";
export { SALES_BFF_REDUCERS, SALES_COMMAND_SUBSCRIPTION_HINTS, salesCommandContract, type SalesBffReducerKey } from "./sales-http";
export {
  PROPOSALS_BFF_REDUCERS,
  PROPOSALS_COMMAND_SUBSCRIPTION_HINTS,
  proposalsCommandContract,
  type ProposalsBffReducerKey,
} from "./proposals-http";
export {
  INVENTORY_BFF_REDUCERS,
  INVENTORY_COMMAND_SUBSCRIPTION_HINTS,
  inventoryCommandContract,
  type InventoryBffReducerKey,
} from "./inventory-http";
export { MANUFACTURING_BFF_REDUCERS, MANUFACTURING_COMMAND_SUBSCRIPTION_HINTS, manufacturingCommandContract, type ManufacturingBffReducerKey } from "./manufacturing-http";
export { EXPENSES_BFF_REDUCERS, EXPENSES_COMMAND_SUBSCRIPTION_HINTS, expensesCommandContract, type ExpensesBffReducerKey } from "./expenses-http";
export { FLEET_BFF_REDUCERS, FLEET_COMMAND_SUBSCRIPTION_HINTS, fleetCommandContract, type FleetBffReducerKey } from "./fleet-http";
export { CALENDAR_BFF_REDUCERS, CALENDAR_COMMAND_SUBSCRIPTION_HINTS, calendarCommandContract, type CalendarBffReducerKey } from "./calendar-http";
export { MESSAGES_BFF_REDUCERS, MESSAGES_COMMAND_SUBSCRIPTION_HINTS, messagesCommandContract, type MessagesBffReducerKey } from "./messages-http";
export { AUTH_BFF_REDUCERS, AUTH_COMMAND_SUBSCRIPTION_HINTS, authCommandContract, type AuthBffReducerKey } from "./auth-http";
export { PURCHASING_BFF_REDUCERS, PURCHASING_COMMAND_SUBSCRIPTION_HINTS, purchasingCommandContract, type PurchasingBffReducerKey } from "./purchasing-http";
export {
  REPORTS_BFF_REDUCERS,
  REPORTS_COMMAND_SUBSCRIPTION_HINTS,
  reportsCommandContract,
  type ReportsBffReducerKey,
} from "./reports-http";
export { HR_BFF_REDUCERS, HR_COMMAND_SUBSCRIPTION_HINTS, hrCommandContract, type HrBffReducerKey } from "./hr-http";
export {
  IOT_BFF_REDUCERS,
  IOT_COMMAND_SUBSCRIPTION_HINTS,
  iotCommandContract,
  type IotBffReducerKey,
} from "./iot-http";
export { PROJECTS_BFF_REDUCERS, PROJECTS_COMMAND_SUBSCRIPTION_HINTS, projectsCommandContract, type ProjectsBffReducerKey } from "./projects-http";
export { SUBSCRIPTIONS_BFF_REDUCERS, SUBSCRIPTIONS_COMMAND_SUBSCRIPTION_HINTS, subscriptionsCommandContract, type SubscriptionsBffReducerKey } from "./subscriptions-http";
export { WORKFLOWS_BFF_REDUCERS, WORKFLOWS_COMMAND_SUBSCRIPTION_HINTS, workflowsCommandContract, type WorkflowsBffReducerKey } from "./workflows-http";
export { DOCUMENTS_BFF_REDUCERS, DOCUMENTS_COMMAND_SUBSCRIPTION_HINTS, documentsCommandContract, type DocumentsBffReducerKey } from "./documents-http";
export { POS_BFF_REDUCERS, POS_COMMAND_SUBSCRIPTION_HINTS, posCommandContract, type PosBffReducerKey } from "./pos-http";
export { HELPDESK_BFF_REDUCERS, HELPDESK_COMMAND_SUBSCRIPTION_HINTS, helpdeskCommandContract, type HelpdeskBffReducerKey } from "./helpdesk-http";
export { AI_AGENTS_BFF_REDUCERS, AI_AGENTS_COMMAND_SUBSCRIPTION_HINTS, aiAgentsCommandContract, type AiAgentsBffReducerKey } from "./ai-agents-http";
export { AI_SKILLS_BFF_REDUCERS, AI_SKILLS_COMMAND_SUBSCRIPTION_HINTS, aiSkillsCommandContract, type AiSkillsBffReducerKey } from "./ai-skills-http";
export { AI_CHAT_BFF_REDUCERS, AI_CHAT_COMMAND_SUBSCRIPTION_HINTS, aiChatCommandContract, type AiChatBffReducerKey } from "./ai-chat-http";
export { AI_REDUCER_ALLOWLIST_BFF_REDUCERS, AI_REDUCER_ALLOWLIST_COMMAND_SUBSCRIPTION_HINTS, aiReducerAllowlistCommandContract, type AiReducerAllowlistBffReducerKey } from "./ai-reducer-allowlist-http";
export { AI_ACTION_DRAFTS_BFF_REDUCERS, AI_ACTION_DRAFTS_COMMAND_SUBSCRIPTION_HINTS, aiActionDraftsCommandContract, type AiActionDraftsBffReducerKey } from "./ai-action-drafts-http";
export { ORGANIZATION_COMPANY_BFF_REDUCERS, ORGANIZATION_COMPANY_COMMAND_SUBSCRIPTION_HINTS, organizationCompanyCommandContract, type OrganizationCompanyBffReducerKey } from "./organization-company-http";
export { ORG_MASTER_CSV_IMPORTS_BFF_REDUCERS, ORG_MASTER_CSV_IMPORTS_COMMAND_SUBSCRIPTION_HINTS, orgMasterCsvImportsCommandContract, type OrgMasterCsvImportsBffReducerKey } from "./org-master-csv-imports-http";
export { SETTINGS_BFF_REDUCERS, SETTINGS_COMMAND_SUBSCRIPTION_HINTS, settingsCommandContract, type SettingsBffReducerKey } from "./settings-http";
export {
  STDB_BFF_REDUCERS,
  stdbBffCallUrl,
  stdbBffCommandPost,
  stdbCommandContract,
  type StdbBffCommandInput,
  type StdbBffNamedReducerKey,
  type StdbBffReducerKey,
} from "./stdb-http";
export { APPROVALS_BFF_REDUCERS, APPROVALS_COMMAND_SUBSCRIPTION_HINTS, approvalsCommandContract, type ApprovalsBffReducerKey } from "./approvals-http";
export { TEMPLATES_BFF_REDUCERS, documentPdfUrl, documentExportUrl, templatesCommandContract, type DocumentPdfKind, type DocumentExportFormat, type DocumentExportKind, type TemplatesBffReducerKey } from "./templates-http";
