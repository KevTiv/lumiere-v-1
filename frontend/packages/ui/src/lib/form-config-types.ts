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
  description: "Daily work journal for tracking progress and reflections",
  type: "journal",
  isActive: true,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  createdBy: "system",
  fields: [
    {
      id: "mood",
      name: "mood",
      label: "How was your day?",
      type: "radio",
      description: "Select your overall mood for the day",
      isSystem: true,
      isEnabled: true,
      order: 1,
      options: [
        { value: "great", label: "Great", color: "green", icon: "star" },
        { value: "good", label: "Good", color: "teal", icon: "smile" },
        { value: "neutral", label: "Neutral", color: "yellow", icon: "meh" },
        { value: "challenging", label: "Challenging", color: "orange", icon: "frown" },
        { value: "difficult", label: "Difficult", color: "red", icon: "cloud" },
      ],
      validation: { required: true },
    },
    {
      id: "accomplishments",
      name: "accomplishments",
      label: "What did you accomplish today?",
      type: "textarea",
      placeholder: "Describe your key accomplishments...",
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
      label: "What challenges did you face?",
      type: "textarea",
      placeholder: "Describe any obstacles or difficulties...",
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
      label: "What did you learn?",
      type: "textarea",
      placeholder: "Any new insights or knowledge...",
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
      label: "What's your focus for tomorrow?",
      type: "textarea",
      placeholder: "Plan your priorities...",
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
      label: "Energy Level",
      type: "slider",
      description: "Rate your energy level (1-10)",
      isSystem: false,
      isEnabled: true,
      order: 6,
      defaultValue: 5,
      validation: { min: 1, max: 10 },
    },
    {
      id: "productivity_score",
      name: "productivity_score",
      label: "Productivity Score",
      type: "rating",
      description: "Rate your productivity (1-5 stars)",
      isSystem: false,
      isEnabled: true,
      order: 7,
      defaultValue: 3,
      validation: { min: 1, max: 5 },
    },
    {
      id: "tags",
      name: "tags",
      label: "Tags",
      type: "tags",
      placeholder: "Add relevant tags...",
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
  description: "Forensic incident report for tracking and analyzing issues",
  type: "forensic",
  isActive: true,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  createdBy: "system",
  fields: [
    {
      id: "title",
      name: "title",
      label: "Incident Title",
      type: "text",
      placeholder: "Brief description of the incident",
      isSystem: true,
      isEnabled: true,
      order: 1,
      validation: { required: true, minLength: 5, maxLength: 100 },
    },
    {
      id: "category",
      name: "category",
      label: "Category",
      type: "select",
      isSystem: true,
      isEnabled: true,
      order: 2,
      options: [
        { value: "process-failure", label: "Process Failure", color: "orange" },
        { value: "system-error", label: "System Error", color: "red" },
        { value: "data-discrepancy", label: "Data Discrepancy", color: "yellow" },
        { value: "compliance-issue", label: "Compliance Issue", color: "purple" },
        { value: "security-incident", label: "Security Incident", color: "red" },
        { value: "performance-issue", label: "Performance Issue", color: "blue" },
        { value: "customer-complaint", label: "Customer Complaint", color: "amber" },
        { value: "quality-defect", label: "Quality Defect", color: "orange" },
        { value: "supply-chain", label: "Supply Chain", color: "teal" },
        { value: "other", label: "Other", color: "gray" },
      ],
      validation: { required: true },
    },
    {
      id: "severity",
      name: "severity",
      label: "Severity",
      type: "radio",
      isSystem: true,
      isEnabled: true,
      order: 3,
      options: [
        { value: "critical", label: "Critical", color: "red" },
        { value: "high", label: "High", color: "orange" },
        { value: "medium", label: "Medium", color: "yellow" },
        { value: "low", label: "Low", color: "green" },
      ],
      validation: { required: true },
    },
    {
      id: "incident_date",
      name: "incident_date",
      label: "Incident Date",
      type: "datetime",
      isSystem: true,
      isEnabled: true,
      order: 4,
      validation: { required: true },
    },
    {
      id: "description",
      name: "description",
      label: "Description",
      type: "textarea",
      placeholder: "Detailed description of the incident...",
      isSystem: true,
      isEnabled: true,
      order: 5,
      validation: { required: true, minLength: 50 },
    },
    {
      id: "affected_area",
      name: "affected_area",
      label: "Affected Area",
      type: "multiselect",
      isSystem: false,
      isEnabled: true,
      order: 6,
      options: [
        { value: "production", label: "Production" },
        { value: "warehouse", label: "Warehouse" },
        { value: "sales", label: "Sales" },
        { value: "customer-service", label: "Customer Service" },
        { value: "finance", label: "Finance" },
        { value: "it", label: "IT Systems" },
        { value: "logistics", label: "Logistics" },
      ],
      validation: { required: true },
    },
    {
      id: "immediate_actions",
      name: "immediate_actions",
      label: "Immediate Actions Taken",
      type: "textarea",
      placeholder: "What actions were taken immediately...",
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
      label: "Root Cause Analysis",
      type: "textarea",
      placeholder: "Initial assessment of root cause...",
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
      label: "Estimated Financial Impact",
      type: "number",
      placeholder: "Enter amount in dollars",
      isSystem: false,
      isEnabled: true,
      order: 9,
      validation: { required: false, min: 0 },
    },
    {
      id: "customers_affected",
      name: "customers_affected",
      label: "Customers Affected",
      type: "number",
      placeholder: "Number of affected customers",
      isSystem: false,
      isEnabled: true,
      order: 10,
      validation: { required: false, min: 0 },
    },
    {
      id: "assigned_to",
      name: "assigned_to",
      label: "Assign To",
      type: "user-select",
      isSystem: true,
      isEnabled: true,
      order: 11,
      validation: { required: true },
    },
    {
      id: "department",
      name: "department",
      label: "Department",
      type: "select",
      isSystem: true,
      isEnabled: true,
      order: 12,
      options: [
        { value: "operations", label: "Operations" },
        { value: "it", label: "IT" },
        { value: "sales", label: "Sales" },
        { value: "warehouse", label: "Warehouse" },
        { value: "quality", label: "Quality Assurance" },
        { value: "finance", label: "Finance" },
        { value: "hr", label: "Human Resources" },
      ],
      validation: { required: true },
    },
    {
      id: "tags",
      name: "tags",
      label: "Tags",
      type: "tags",
      placeholder: "Add relevant tags...",
      isSystem: true,
      isEnabled: true,
      order: 13,
      validation: { required: false },
    },
    {
      id: "attachments",
      name: "attachments",
      label: "Attachments",
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
