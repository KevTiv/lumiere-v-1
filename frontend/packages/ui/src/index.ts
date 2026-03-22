// Web components (shadcn/ui based)
export * from "./components/button";
export * from "./components/theme-provider";
// form.tsx: exclude FormField (conflicts with lib/form-types FormField type)
export { Form, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from "./components/form";
export * from "./components/toast";
export * from "./components/toaster";
export * from "./components/use-mobile";
export * from "./lib/utils";

// Entity views (config-driven table + detail)
export * from "./entity-views/entity-view";
export * from "./entity-views/entity-table";
export * from "./entity-views/entity-detail";
export * from "./lib/entity-view-types"; // exports FieldWidth, ColumnType
export * from "./lib/entity-configs";

// Modular forms
export * from "./forms/modular-form";
export * from "./forms/form-modal";
// form-types: exclude FieldWidth (already in entity-view-types), include everything else
export type {
  FieldType,
  BaseField,
  TextField,
  NumberField,
  TextareaField,
  SelectField,
  CheckboxField,
  SwitchField,
  RadioField,
  DateField,
  FileField,
  HiddenField,
  CustomField,
  FormField,
  FormSection,
  FormConfig,
} from "./lib/form-types";
export { fieldWidthClasses } from "./lib/form-types";
export * from "./lib/form-configs";
export * from "./lib/accounting-form-configs";
export * from "./lib/accounting-entity-configs";
export * from "./lib/sales-entity-configs";
export * from "./lib/sales-form-configs";
export * from "./lib/crm-entity-configs";
export * from "./lib/crm-form-configs";
export * from "./lib/projects-entity-configs";
export * from "./lib/projects-form-configs";
export * from "./lib/inventory-entity-configs";
export * from "./lib/inventory-form-configs";
export * from "./lib/purchasing-entity-configs";
export * from "./lib/purchasing-form-configs";
export * from "./lib/manufacturing-entity-configs";
export * from "./lib/manufacturing-form-configs";
export * from "./lib/hr-entity-configs";
export * from "./lib/hr-form-configs";
export * from "./lib/documents-entity-configs";
export * from "./lib/documents-form-configs";
export * from "./lib/calendar-types";
export * from "./lib/calendar-entity-configs";
export * from "./lib/calendar-form-configs";
export * from "./lib/reports-entity-configs";
export * from "./lib/reports-form-configs";
export * from "./lib/subscriptions-entity-configs";
export * from "./lib/subscriptions-form-configs";
export * from "./lib/expenses-entity-configs";
export * from "./lib/expenses-form-configs";
export * from "./lib/helpdesk-entity-configs";
export * from "./lib/helpdesk-form-configs";
export * from "./lib/workflows-entity-configs";
export * from "./lib/workflows-form-configs";
export * from "./lib/messages-entity-configs";
export * from "./lib/messages-form-configs";
export * from "./lib/proposals-entity-configs";
export * from "./lib/proposals-form-configs";
export * from "./lib/proposal-workspace-types";

// Dashboard pages & widgets
export * from "./pages/dashboard-grid";
export * from "./pages/dashboard-header";
export * from "./pages/dashboard-sidebar";
export * from "./pages/dashboard-widget-renderer";
export * from "./lib/dashboard-types";
export * from "./lib/dashboard-config";

// Module view (config-driven tabs + entity views + forms)
export * from "./lib/module-types";
export * from "./pages/module-view";

// RBAC
export * from "./lib/rbac-types";
export * from "./lib/rbac-defaults";
export * from "./lib/rbac-context";

// Feature types
export * from "./lib/ai-chat-types";
// entry-table-types: exclude ColumnType (already in entity-view-types)
export type {
  ColumnWidth,
  BaseColumn,
  TextColumn,
  NumberColumn,
  DateColumn,
  CurrencyColumn,
  ImageColumn,
  AvatarColumn,
  BadgeColumn,
  StatusColumn,
  ProgressColumn,
  ActionsColumn,
  CustomColumn,
  TableColumn,
  EntryData,
  EntryTableConfig,
} from "./lib/entry-table-types";
export { columnWidthClasses } from "./lib/entry-table-types";
export * from "./lib/forensic-report-types";
export * from "./lib/journal-types";
export * from "./lib/task-board-types";
// form-config-types: exclude FieldType (already in form-types)
export type {
  FieldOption,
  FieldValidation,
  ConfigurableField,
  FormConfiguration,
  UserCustomField,
} from "./lib/form-config-types";
export {
  defaultJournalFormConfig,
  defaultForensicFormConfig,
  sampleUserCustomFields,
  getMergedFormFields,
} from "./lib/form-config-types";
// notebook-types: exclude ReportTemplate/reportTemplates (already in forensic-report-types)
export type {
  CellType as NotebookCellType,
  CellStatus,
  OutputType,
  CellOutput,
  NotebookCell,
  Notebook,
  NotebookMetadata,
  KernelState,
  CodeSuggestion,
  NotebookDataContext,
  MLModelOutput,
  ChartConfig,
} from "./lib/notebook-types";
export { mlSnippets, reportTemplates as notebookReportTemplates } from "./lib/notebook-types";

// Feature components
export * from "./ai-chat/ai-chat-panel";
export * from "./entry-table/entry-table-viewer";
export * from "./entry-table/entry-detail-modal";
export * from "./entry-table/entry-table-cell";
export * from "./forensics/forensics-view";
export * from "./forensics/report-card";
export * from "./forensics/report-detail-modal";
export * from "./forensics/create-report-modal";
export * from "./journal/journal-panel";
export * from "./notebook/notebook-panel";
export * from "./notebook/notebook-cell";
export * from "./tasks/task-board-view";
export * from "./tasks/task-detail-modal";
export * from "./tasks/create-task-modal";
export * from "./settings/settings-module";
export * from "./settings/user-management";
export * from "./settings/role-management";
export * from "./settings/profile-settings";
export * from "./settings/user-switcher";
export * from "./settings/audit-log";
export * from "./settings/form-config-settings";
export * from "./settings/user-custom-fields";

// Hooks
export * from "./hooks/use-toast";

// Accounting components
export * from "./accounting-components/invoice-list-view";
export * from "./accounting-components/invoice-detail-modal";
export * from "./accounting-components/create-invoice-modal";
export * from "./accounting-components/bills-list-view";
export * from "./accounting-components/chart-of-accounts-view";
export * from "./accounting-components/general-ledger-view";

// Calendar components
export * from "./calendar-components/calendar-view";
export * from "./calendar-components/event-detail-panel";

// Map components — MapView is intentionally NOT exported from this barrel.
// Leaflet requires browser APIs and cannot be bundled via server/SSR paths.
// Use dynamic() in your client component instead:
//   dynamic(() => import("@lumiere/ui/map-components/map-view").then(m => m.MapView), { ssr: false })
export * from "./map-components/map-pin-hover-card";
export * from "./map-components/map-layer-legend";
export * from "./lib/map-types";
export * from "./lib/map-pin-configs";

// Proposal workspace
export * from "./proposal-workspace/proposal-workspace";
export * from "./proposal-workspace/document-input-panel";
export * from "./proposal-workspace/ai-analysis-panel";
export * from "./proposal-workspace/tender-editor-panel";
export * from "./proposal-workspace/version-history-bar";
export * from "./proposal-workspace/version-diff-modal";

export * from "./pos/pos-page";
