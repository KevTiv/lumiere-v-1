import { i18n as uiI18n } from "@lumiere/i18n"
// Configurable Form Fields System for Journal and Forensic Reports

export type FieldType = 
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "multiselect"
  | "date"
  | "time"
  | "datetime"
  | "checkbox"
  | "radio"
  | "rating"
  | "slider"
  | "tags"
  | "user-select"
  | "file"

export interface FieldOption {
  value: string
  label: string
  color?: string
  icon?: string
}

export interface FieldValidation {
  required?: boolean
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  pattern?: string
  message?: string
}

export interface ConfigurableField {
  id: string
  name: string
  label: string
  type: FieldType
  description?: string
  placeholder?: string
  defaultValue?: unknown
  options?: FieldOption[]
  validation?: FieldValidation
  aiSuggestions?: string[]
  showInList?: boolean
  order: number
  isSystem?: boolean // System fields cannot be deleted
  isEnabled: boolean
  roleVisibility?: string[] // Which roles can see this field
  category?: string
}

export interface FormConfiguration {
  id: string
  name: string
  description: string
  type: "journal" | "forensic" | "custom"
  fields: ConfigurableField[]
  roleConfigs?: Record<string, { 
    enabledFields: string[]
    requiredFields: string[]
    defaultPrompts?: string[]
  }>
  createdAt: string
  updatedAt: string
  createdBy: string
  isActive: boolean
}

export interface UserCustomField {
  id: string
  userId: string
  formType: "journal" | "forensic"
  field: ConfigurableField
  createdAt: string
}

// Default Journal Form Configuration
export const defaultJournalFormConfig: FormConfiguration = {
  id: "journal-default",
  name: "Daily Journal",
  get description() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.journalDefault.description") },
  type: "journal",
  isActive: true,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  createdBy: "system",
  fields: [
    {
      id: "mood",
      name: "mood",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.mood.label") },
      type: "radio",
      get description() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.mood.description") },
      isSystem: true,
      isEnabled: true,
      order: 1,
      options: [
        { value: "great", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.mood.labelgreat") }, color: "green", icon: "star" },
        { value: "good", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.mood.labelgood") }, color: "teal", icon: "smile" },
        { value: "neutral", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.mood.labelneutral") }, color: "yellow", icon: "meh" },
        { value: "challenging", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.mood.labelchallenging") }, color: "orange", icon: "frown" },
        { value: "difficult", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.mood.labeldifficult") }, color: "red", icon: "cloud" },
      ],
      validation: { required: true },
    },
    {
      id: "accomplishments",
      name: "accomplishments",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.accomplishments.label") },
      type: "textarea",
      get placeholder() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.accomplishments.placeholder") },
      isSystem: true,
      isEnabled: true,
      order: 2,
      aiSuggestions: ["Completed assigned tasks", "Made progress on project", "Helped a colleague"],
      validation: { required: true, minLength: 10 },
      category: "accomplishment",
    },
    {
      id: "challenges",
      name: "challenges",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.challenges.label") },
      type: "textarea",
      get placeholder() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.challenges.placeholder") },
      isSystem: true,
      isEnabled: true,
      order: 3,
      aiSuggestions: ["Technical issue", "Time constraint", "Communication gap"],
      validation: { required: false },
      category: "challenge",
    },
    {
      id: "learnings",
      name: "learnings",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.learnings.label") },
      type: "textarea",
      get placeholder() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.learnings.placeholder") },
      isSystem: true,
      isEnabled: true,
      order: 4,
      aiSuggestions: ["New skill", "Process improvement", "Industry insight"],
      validation: { required: false },
      category: "learning",
    },
    {
      id: "tomorrow_focus",
      name: "tomorrow_focus",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.tomorrowFocus.label") },
      type: "textarea",
      get placeholder() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.tomorrowFocus.placeholder") },
      isSystem: false,
      isEnabled: true,
      order: 5,
      aiSuggestions: ["Complete pending tasks", "Start new project", "Follow up on items"],
      validation: { required: false },
      category: "goal",
    },
    {
      id: "energy_level",
      name: "energy_level",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.energyLevel.label") },
      type: "slider",
      get description() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.energyLevel.description") },
      isSystem: false,
      isEnabled: true,
      order: 6,
      defaultValue: 5,
      validation: { min: 1, max: 10 },
    },
    {
      id: "productivity_score",
      name: "productivity_score",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.productivityScore.label") },
      type: "rating",
      get description() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.productivityScore.description") },
      isSystem: false,
      isEnabled: true,
      order: 7,
      defaultValue: 3,
      validation: { min: 1, max: 5 },
    },
    {
      id: "tags",
      name: "tags",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.tags.label") },
      type: "tags",
      get placeholder() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultJournalFormConfig.tags.placeholder") },
      isSystem: true,
      isEnabled: true,
      order: 8,
      validation: { required: false },
    },
  ],
  roleConfigs: {
    "role-admin": {
      enabledFields: ["mood", "accomplishments", "challenges", "learnings", "tomorrow_focus", "energy_level", "productivity_score", "tags"],
      requiredFields: ["mood", "accomplishments"],
      defaultPrompts: ["What system or team decisions did you make today?", "Were there any security concerns?"],
    },
    "role-manager": {
      enabledFields: ["mood", "accomplishments", "challenges", "learnings", "tomorrow_focus", "energy_level", "productivity_score", "tags"],
      requiredFields: ["mood", "accomplishments"],
      defaultPrompts: ["What progress did your team make?", "Did you have meaningful 1:1s?"],
    },
    "role-sales": {
      enabledFields: ["mood", "accomplishments", "challenges", "learnings", "tomorrow_focus", "tags"],
      requiredFields: ["mood", "accomplishments"],
      defaultPrompts: ["How many customer touchpoints did you have?", "Did you move any deals forward?"],
    },
    "role-warehouse": {
      enabledFields: ["mood", "accomplishments", "challenges", "tags"],
      requiredFields: ["mood", "accomplishments"],
      defaultPrompts: ["How many orders did you process?", "Were there any inventory issues?"],
    },
    "role-viewer": {
      enabledFields: ["mood", "accomplishments", "learnings", "tags"],
      requiredFields: ["mood"],
      defaultPrompts: ["What data did you review?", "Did you notice any patterns?"],
    },
  },
}

// Default Forensic Report Form Configuration
export const defaultForensicFormConfig: FormConfiguration = {
  id: "forensic-default",
  name: "Incident Report",
  get description() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.forensicDefault.description") },
  type: "forensic",
  isActive: true,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  createdBy: "system",
  fields: [
    {
      id: "title",
      name: "title",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.title.label") },
      type: "text",
      get placeholder() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.title.placeholder") },
      isSystem: true,
      isEnabled: true,
      order: 1,
      validation: { required: true, minLength: 5, maxLength: 100 },
    },
    {
      id: "category",
      name: "category",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.category.label") },
      type: "select",
      isSystem: true,
      isEnabled: true,
      order: 2,
      options: [
        { value: "process-failure", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.category.labelprocessFailure") }, color: "orange" },
        { value: "system-error", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.category.labelsystemError") }, color: "red" },
        { value: "data-discrepancy", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.category.labeldataDiscrepancy") }, color: "yellow" },
        { value: "compliance-issue", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.category.labelcomplianceIssue") }, color: "purple" },
        { value: "security-incident", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.category.labelsecurityIncident") }, color: "red" },
        { value: "performance-issue", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.category.labelperformanceIssue") }, color: "blue" },
        { value: "customer-complaint", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.category.labelcustomerComplaint") }, color: "amber" },
        { value: "quality-defect", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.category.labelqualityDefect") }, color: "orange" },
        { value: "supply-chain", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.category.labelsupplyChain") }, color: "teal" },
        { value: "other", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.category.labelother") }, color: "gray" },
      ],
      validation: { required: true },
    },
    {
      id: "severity",
      name: "severity",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.severity.label") },
      type: "radio",
      isSystem: true,
      isEnabled: true,
      order: 3,
      options: [
        { value: "critical", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.severity.labelcritical") }, color: "red" },
        { value: "high", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.severity.labelhigh") }, color: "orange" },
        { value: "medium", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.severity.labelmedium") }, color: "yellow" },
        { value: "low", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.severity.labellow") }, color: "green" },
      ],
      validation: { required: true },
    },
    {
      id: "incident_date",
      name: "incident_date",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.incidentDate.label") },
      type: "datetime",
      isSystem: true,
      isEnabled: true,
      order: 4,
      validation: { required: true },
    },
    {
      id: "description",
      name: "description",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.description.label") },
      type: "textarea",
      get placeholder() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.description.placeholder") },
      isSystem: true,
      isEnabled: true,
      order: 5,
      validation: { required: true, minLength: 50 },
    },
    {
      id: "affected_area",
      name: "affected_area",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.affectedArea.label") },
      type: "multiselect",
      isSystem: false,
      isEnabled: true,
      order: 6,
      options: [
        { value: "production", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.affectedArea.labelproduction") } },
        { value: "warehouse", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.affectedArea.labelwarehouse") } },
        { value: "sales", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.affectedArea.labelsales") } },
        { value: "customer-service", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.affectedArea.labelcustomerService") } },
        { value: "finance", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.affectedArea.labelfinance") } },
        { value: "it", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.affectedArea.labeliTSystems") } },
        { value: "logistics", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.affectedArea.labellogistics") } },
      ],
      validation: { required: true },
    },
    {
      id: "immediate_actions",
      name: "immediate_actions",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.immediateActions.label") },
      type: "textarea",
      get placeholder() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.immediateActions.placeholder") },
      isSystem: true,
      isEnabled: true,
      order: 7,
      aiSuggestions: [
        "Isolated affected system",
        "Notified stakeholders",
        "Initiated backup procedures",
        "Documented initial findings",
      ],
      validation: { required: false },
    },
    {
      id: "root_cause",
      name: "root_cause",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.rootCause.label") },
      type: "textarea",
      get placeholder() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.rootCause.placeholder") },
      isSystem: true,
      isEnabled: true,
      order: 8,
      aiSuggestions: [
        "Human error",
        "System malfunction",
        "Process gap",
        "External factor",
        "Communication breakdown",
      ],
      validation: { required: false },
    },
    {
      id: "financial_impact",
      name: "financial_impact",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.financialImpact.label") },
      type: "number",
      get placeholder() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.financialImpact.placeholder") },
      isSystem: false,
      isEnabled: true,
      order: 9,
      validation: { required: false, min: 0 },
    },
    {
      id: "customers_affected",
      name: "customers_affected",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.customersAffected.label") },
      type: "number",
      get placeholder() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.customersAffected.placeholder") },
      isSystem: false,
      isEnabled: true,
      order: 10,
      validation: { required: false, min: 0 },
    },
    {
      id: "assigned_to",
      name: "assigned_to",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.assignedTo.label") },
      type: "user-select",
      isSystem: true,
      isEnabled: true,
      order: 11,
      validation: { required: true },
    },
    {
      id: "department",
      name: "department",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.department.label") },
      type: "select",
      isSystem: true,
      isEnabled: true,
      order: 12,
      options: [
        { value: "operations", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.department.labeloperations") } },
        { value: "it", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.department.labeliT") } },
        { value: "sales", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.department.labelsales") } },
        { value: "warehouse", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.department.labelwarehouse") } },
        { value: "quality", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.department.labelqualityAssurance") } },
        { value: "finance", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.department.labelfinance") } },
        { value: "hr", get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.department.labelhumanResources") } },
      ],
      validation: { required: true },
    },
    {
      id: "tags",
      name: "tags",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.tags.label") },
      type: "tags",
      get placeholder() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.tags.placeholder") },
      isSystem: true,
      isEnabled: true,
      order: 13,
      validation: { required: false },
    },
    {
      id: "attachments",
      name: "attachments",
      get label() { return uiI18n.t("journal.builtIn.formConfigTypes.defaultForensicFormConfig.attachments.label") },
      type: "file",
      isSystem: false,
      isEnabled: true,
      order: 14,
      validation: { required: false },
    },
  ],
  roleConfigs: {
    "role-admin": {
      enabledFields: ["title", "category", "severity", "incident_date", "description", "affected_area", "immediate_actions", "root_cause", "financial_impact", "customers_affected", "assigned_to", "department", "tags", "attachments"],
      requiredFields: ["title", "category", "severity", "incident_date", "description", "assigned_to", "department"],
    },
    "role-manager": {
      enabledFields: ["title", "category", "severity", "incident_date", "description", "affected_area", "immediate_actions", "root_cause", "financial_impact", "customers_affected", "assigned_to", "department", "tags", "attachments"],
      requiredFields: ["title", "category", "severity", "incident_date", "description", "assigned_to", "department"],
    },
    "role-sales": {
      enabledFields: ["title", "category", "severity", "incident_date", "description", "customers_affected", "tags"],
      requiredFields: ["title", "category", "severity", "description"],
    },
    "role-warehouse": {
      enabledFields: ["title", "category", "severity", "incident_date", "description", "affected_area", "immediate_actions", "tags"],
      requiredFields: ["title", "category", "severity", "description"],
    },
  },
}

// Sample user custom fields
export const sampleUserCustomFields: UserCustomField[] = [
  {
    id: "ucf-1",
    userId: "user-3",
    formType: "journal",
    field: {
      id: "deals_touched",
      name: "deals_touched",
      label: "Deals Touched Today",
      type: "number",
      description: "Track number of deals you worked on",
      isSystem: false,
      isEnabled: true,
      order: 100,
      validation: { min: 0 },
    },
    createdAt: "2024-02-15T00:00:00Z",
  },
  {
    id: "ucf-2",
    userId: "user-3",
    formType: "journal",
    field: {
      id: "pipeline_value",
      name: "pipeline_value",
      label: "Pipeline Value Added",
      type: "number",
      description: "Total value added to pipeline today",
      placeholder: "Enter amount in dollars",
      isSystem: false,
      isEnabled: true,
      order: 101,
      validation: { min: 0 },
    },
    createdAt: "2024-02-15T00:00:00Z",
  },
  {
    id: "ucf-3",
    userId: "user-4",
    formType: "journal",
    field: {
      id: "orders_processed",
      name: "orders_processed",
      label: "Orders Processed",
      type: "number",
      description: "Number of orders processed today",
      isSystem: false,
      isEnabled: true,
      order: 100,
      validation: { min: 0 },
    },
    createdAt: "2024-02-20T00:00:00Z",
  },
]

// Helper function to get merged fields for a user
export function getMergedFormFields(
  formConfig: FormConfiguration,
  roleId: string,
  userCustomFields: UserCustomField[],
  userId: string
): ConfigurableField[] {
  const roleConfig = formConfig.roleConfigs?.[roleId]
  const enabledFieldIds = roleConfig?.enabledFields || formConfig.fields.map(f => f.id)
  
  // Get base fields that are enabled for this role
  const baseFields = formConfig.fields
    .filter(f => f.isEnabled && enabledFieldIds.includes(f.id))
    .map(f => ({
      ...f,
      validation: {
        ...f.validation,
        required: roleConfig?.requiredFields?.includes(f.id) || f.validation?.required,
      },
    }))
  
  // Get user's custom fields for this form type
  const customFields = userCustomFields
    .filter(ucf => ucf.userId === userId && ucf.formType === formConfig.type)
    .map(ucf => ucf.field)
  
  // Merge and sort by order
  return [...baseFields, ...customFields].sort((a, b) => a.order - b.order)
}
