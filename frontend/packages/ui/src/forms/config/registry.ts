//! Form Registry - Central registry for all configurable forms
//!
//! This module provides a registry of all forms across all modules,
//! allowing dynamic form lookup and configuration.

import type { FormRegistryEntry, FormModuleMetadata, DefaultFormConfiguration } from "./types"

import { crmForms } from "./modules/crm.config"
import { salesForms } from "./modules/sales.config"
import { inventoryForms } from "./modules/inventory.config"
import { accountingForms } from "./modules/accounting.config"
import { hrForms } from "./modules/hr.config"
import { purchasingForms } from "./modules/purchasing.config"
import { projectsForms } from "./modules/projects.config"
import { documentsForms } from "./modules/documents.config"
import { manufacturingForms } from "./modules/manufacturing.config"
import { helpdeskForms } from "./modules/helpdesk.config"
import { expensesForms } from "./modules/expenses.config"
import { calendarForms } from "./modules/calendar.config"
import { subscriptionsForms } from "./modules/subscriptions.config"
import { proposalsForms } from "./modules/proposals.config"
import { reportsForms } from "./modules/reports.config"

// ═════════════════════════════════════════════════════════════════════════════
// MODULE IMPORTS (will be populated as we create module configs)
// ═════════════════════════════════════════════════════════════════════════════

// Journal module
const journalForms: FormRegistryEntry[] = [
  {
    moduleId: "journal",
    formId: "daily-entry",
    name: "Daily Journal",
    description: "Daily work journal for tracking progress and reflections",
    icon: "BookMarked",
    category: "Productivity",
    defaultConfig: () => ({
      moduleId: "journal",
      formId: "daily-entry",
      name: "Daily Journal",
      description: "Daily work journal for tracking progress and reflections",
      isSystemDefault: true,
      fields: [
        {
          fieldId: "mood",
          name: "mood",
          label: "How was your day?",
          fieldType: "Radio",
          options: [
            { value: "great", label: "Great", color: "green", icon: "star" },
            { value: "good", label: "Good", color: "teal", icon: "smile" },
            { value: "neutral", label: "Neutral", color: "yellow", icon: "meh" },
            { value: "challenging", label: "Challenging", color: "orange", icon: "frown" },
            { value: "difficult", label: "Difficult", color: "red", icon: "cloud" },
          ],
          validation: { required: true },
          aiSuggestions: [],
          order: 1,
          isSystem: true,
          isEnabled: true,
          showInList: false,
          width: "Full",
        },
        {
          fieldId: "accomplishments",
          name: "accomplishments",
          label: "What did you accomplish today?",
          fieldType: "Textarea",
          placeholder: "Describe your key accomplishments...",
          validation: { required: true, minLength: 10 },
          aiSuggestions: ["Completed assigned tasks", "Made progress on project", "Helped a colleague"],
          order: 2,
          isSystem: true,
          isEnabled: true,
          category: "accomplishment",
          showInList: false,
          width: "Full",
        },
        {
          fieldId: "challenges",
          name: "challenges",
          label: "What challenges did you face?",
          fieldType: "Textarea",
          placeholder: "Describe any obstacles or difficulties...",
          validation: { required: false },
          aiSuggestions: ["Technical issue", "Time constraint", "Communication gap"],
          order: 3,
          isSystem: true,
          isEnabled: true,
          category: "challenge",
          showInList: false,
          width: "Full",
        },
        {
          fieldId: "learnings",
          name: "learnings",
          label: "What did you learn?",
          fieldType: "Textarea",
          placeholder: "Any new insights or knowledge...",
          validation: { required: false },
          aiSuggestions: ["New skill", "Process improvement", "Industry insight"],
          order: 4,
          isSystem: true,
          isEnabled: true,
          category: "learning",
          showInList: false,
          width: "Full",
        },
        {
          fieldId: "tomorrow_focus",
          name: "tomorrow_focus",
          label: "What's your focus for tomorrow?",
          fieldType: "Textarea",
          placeholder: "Plan your priorities...",
          validation: { required: false },
          aiSuggestions: ["Complete pending tasks", "Start new project", "Follow up on items"],
          order: 5,
          isSystem: false,
          isEnabled: true,
          category: "goal",
          showInList: false,
          width: "Full",
        },
        {
          fieldId: "energy_level",
          name: "energy_level",
          label: "Energy Level",
          fieldType: "Slider",
          description: "Rate your energy level (1-10)",
          defaultValue: "5",
          validation: { required: false, min: 1, max: 10 },
          aiSuggestions: [],
          order: 6,
          isSystem: false,
          isEnabled: true,
          showInList: false,
          width: "Half",
        },
        {
          fieldId: "productivity_score",
          name: "productivity_score",
          label: "Productivity Score",
          fieldType: "Rating",
          description: "Rate your productivity (1-5 stars)",
          defaultValue: "3",
          validation: { required: false, min: 1, max: 5 },
          aiSuggestions: [],
          order: 7,
          isSystem: false,
          isEnabled: true,
          showInList: false,
          width: "Half",
        },
        {
          fieldId: "tags",
          name: "tags",
          label: "Tags",
          fieldType: "Tags",
          placeholder: "Add relevant tags...",
          validation: { required: false },
          aiSuggestions: [],
          order: 8,
          isSystem: true,
          isEnabled: true,
          showInList: true,
          width: "Full",
        },
      ],
      roleConfigs: {
        "role-admin": {
          roleId: "role-admin",
          enabledFields: ["mood", "accomplishments", "challenges", "learnings", "tomorrow_focus", "energy_level", "productivity_score", "tags"],
          requiredFields: ["mood", "accomplishments"],
          defaultPrompts: ["What system or team decisions did you make today?", "Were there any security concerns?"],
        },
        "role-manager": {
          roleId: "role-manager",
          enabledFields: ["mood", "accomplishments", "challenges", "learnings", "tomorrow_focus", "energy_level", "productivity_score", "tags"],
          requiredFields: ["mood", "accomplishments"],
          defaultPrompts: ["What progress did your team make?", "Did you have meaningful 1:1s?"],
        },
        "role-sales": {
          roleId: "role-sales",
          enabledFields: ["mood", "accomplishments", "challenges", "learnings", "tomorrow_focus", "tags"],
          requiredFields: ["mood", "accomplishments"],
          defaultPrompts: ["How many customer touchpoints did you have?", "Did you move any deals forward?"],
        },
        "role-warehouse": {
          roleId: "role-warehouse",
          enabledFields: ["mood", "accomplishments", "challenges", "tags"],
          requiredFields: ["mood", "accomplishments"],
          defaultPrompts: ["How many orders did you process?", "Were there any inventory issues?"],
        },
        "role-viewer": {
          roleId: "role-viewer",
          enabledFields: ["mood", "accomplishments", "learnings", "tags"],
          requiredFields: ["mood"],
          defaultPrompts: ["What data did you review?", "Did you notice any patterns?"],
        },
      },
    }),
  },
]

// Forensic module
const forensicForms: FormRegistryEntry[] = [
  {
    moduleId: "forensic",
    formId: "incident-report",
    name: "Incident Report",
    description: "Forensic incident report for tracking and analyzing issues",
    icon: "FileSearch",
    category: "Compliance",
    defaultConfig: () => ({
      moduleId: "forensic",
      formId: "incident-report",
      name: "Incident Report",
      description: "Forensic incident report for tracking and analyzing issues",
      isSystemDefault: true,
      fields: [
        {
          fieldId: "title",
          name: "title",
          label: "Incident Title",
          fieldType: "Text",
          placeholder: "Brief description of the incident",
          validation: { required: true, minLength: 5, maxLength: 100 },
          aiSuggestions: [],
          order: 1,
          isSystem: true,
          isEnabled: true,
          showInList: true,
          width: "Full",
        },
        {
          fieldId: "category",
          name: "category",
          label: "Category",
          fieldType: "Select",
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
          aiSuggestions: [],
          order: 2,
          isSystem: true,
          isEnabled: true,
          showInList: true,
          width: "Half",
        },
        {
          fieldId: "severity",
          name: "severity",
          label: "Severity",
          fieldType: "Radio",
          options: [
            { value: "critical", label: "Critical", color: "red" },
            { value: "high", label: "High", color: "orange" },
            { value: "medium", label: "Medium", color: "yellow" },
            { value: "low", label: "Low", color: "green" },
          ],
          validation: { required: true },
          aiSuggestions: [],
          order: 3,
          isSystem: true,
          isEnabled: true,
          showInList: true,
          width: "Half",
        },
        {
          fieldId: "incident_date",
          name: "incident_date",
          label: "Incident Date",
          fieldType: "DateTime",
          validation: { required: true },
          aiSuggestions: [],
          order: 4,
          isSystem: true,
          isEnabled: true,
          showInList: false,
          width: "Half",
        },
        {
          fieldId: "description",
          name: "description",
          label: "Description",
          fieldType: "Textarea",
          placeholder: "Detailed description of the incident...",
          validation: { required: true, minLength: 50 },
          aiSuggestions: [],
          order: 5,
          isSystem: true,
          isEnabled: true,
          showInList: false,
          width: "Full",
        },
        {
          fieldId: "affected_area",
          name: "affected_area",
          label: "Affected Area",
          fieldType: "MultiSelect",
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
          aiSuggestions: [],
          order: 6,
          isSystem: false,
          isEnabled: true,
          showInList: false,
          width: "Full",
        },
        {
          fieldId: "immediate_actions",
          name: "immediate_actions",
          label: "Immediate Actions Taken",
          fieldType: "Textarea",
          placeholder: "What actions were taken immediately...",
          validation: { required: false },
          aiSuggestions: ["Isolated affected system", "Notified stakeholders", "Initiated backup procedures", "Documented initial findings"],
          order: 7,
          isSystem: true,
          isEnabled: true,
          showInList: false,
          width: "Full",
        },
        {
          fieldId: "root_cause",
          name: "root_cause",
          label: "Root Cause Analysis",
          fieldType: "Textarea",
          placeholder: "Initial assessment of root cause...",
          validation: { required: false },
          aiSuggestions: ["Human error", "System malfunction", "Process gap", "External factor", "Communication breakdown"],
          order: 8,
          isSystem: true,
          isEnabled: true,
          showInList: false,
          width: "Full",
        },
        {
          fieldId: "financial_impact",
          name: "financial_impact",
          label: "Estimated Financial Impact",
          fieldType: "Number",
          placeholder: "Enter amount in dollars",
          validation: { required: false, min: 0 },
          aiSuggestions: [],
          order: 9,
          isSystem: false,
          isEnabled: true,
          showInList: false,
          width: "Half",
        },
        {
          fieldId: "customers_affected",
          name: "customers_affected",
          label: "Customers Affected",
          fieldType: "Number",
          placeholder: "Number of affected customers",
          validation: { required: false, min: 0 },
          aiSuggestions: [],
          order: 10,
          isSystem: false,
          isEnabled: true,
          showInList: false,
          width: "Half",
        },
        {
          fieldId: "assigned_to",
          name: "assigned_to",
          label: "Assign To",
          fieldType: "UserSelect",
          validation: { required: true },
          aiSuggestions: [],
          order: 11,
          isSystem: true,
          isEnabled: true,
          showInList: true,
          width: "Half",
        },
        {
          fieldId: "department",
          name: "department",
          label: "Department",
          fieldType: "Select",
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
          aiSuggestions: [],
          order: 12,
          isSystem: true,
          isEnabled: true,
          showInList: false,
          width: "Half",
        },
        {
          fieldId: "tags",
          name: "tags",
          label: "Tags",
          fieldType: "Tags",
          placeholder: "Add relevant tags...",
          validation: { required: false },
          aiSuggestions: [],
          order: 13,
          isSystem: true,
          isEnabled: true,
          showInList: true,
          width: "Full",
        },
        {
          fieldId: "attachments",
          name: "attachments",
          label: "Attachments",
          fieldType: "File",
          validation: { required: false },
          aiSuggestions: [],
          order: 14,
          isSystem: false,
          isEnabled: true,
          showInList: false,
          width: "Full",
        },
      ],
      roleConfigs: {
        "role-admin": {
          roleId: "role-admin",
          enabledFields: ["title", "category", "severity", "incident_date", "description", "affected_area", "immediate_actions", "root_cause", "financial_impact", "customers_affected", "assigned_to", "department", "tags", "attachments"],
          requiredFields: ["title", "category", "severity", "incident_date", "description", "assigned_to", "department"],
          defaultPrompts: [],
        },
        "role-manager": {
          roleId: "role-manager",
          enabledFields: ["title", "category", "severity", "incident_date", "description", "affected_area", "immediate_actions", "root_cause", "financial_impact", "customers_affected", "assigned_to", "department", "tags", "attachments"],
          requiredFields: ["title", "category", "severity", "incident_date", "description", "assigned_to", "department"],
          defaultPrompts: [],
        },
        "role-sales": {
          roleId: "role-sales",
          enabledFields: ["title", "category", "severity", "incident_date", "description", "customers_affected", "tags"],
          requiredFields: ["title", "category", "severity", "description"],
          defaultPrompts: [],
        },
        "role-warehouse": {
          roleId: "role-warehouse",
          enabledFields: ["title", "category", "severity", "incident_date", "description", "affected_area", "immediate_actions", "tags"],
          requiredFields: ["title", "category", "severity", "description"],
          defaultPrompts: [],
        },
      },
    }),
  },
]

// ═════════════════════════════════════════════════════════════════════════════
// REGISTRY IMPLEMENTATION
// ═════════════════════════════════════════════════════════════════════════════

class FormRegistry {
  private forms: Map<string, FormRegistryEntry> = new Map()
  private modules: Map<string, FormModuleMetadata> = new Map()

  constructor() {
    this.initializeRegistry()
  }

  private initializeRegistry() {
    // Register Journal forms
    for (const form of journalForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "journal",
      name: "Journal",
      description: "Daily work journals and notes",
      icon: "BookMarked",
      color: "blue",
      forms: journalForms,
    })

    // Register Forensic forms
    for (const form of forensicForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "forensic",
      name: "Forensic Reports",
      description: "Incident tracking and forensic analysis",
      icon: "FileSearch",
      color: "red",
      forms: forensicForms,
    })

    // Register CRM forms
    for (const form of crmForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "crm",
      name: "CRM",
      description: "Customer relationship management",
      icon: "Users",
      color: "green",
      forms: crmForms,
    })

    // Register Sales forms
    for (const form of salesForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "sales",
      name: "Sales",
      description: "Sales orders and price management",
      icon: "ShoppingCart",
      color: "purple",
      forms: salesForms,
    })

    // Register Inventory forms
    for (const form of inventoryForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "inventory",
      name: "Inventory",
      description: "Product and stock management",
      icon: "Package",
      color: "orange",
      forms: inventoryForms,
    })

    // Register Accounting forms
    for (const form of accountingForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "accounting",
      name: "Accounting",
      description: "Invoices and financial management",
      icon: "Landmark",
      color: "yellow",
      forms: accountingForms,
    })

    // Register HR forms
    for (const form of hrForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "hr",
      name: "HR",
      description: "Human resources management",
      icon: "Users",
      color: "pink",
      forms: hrForms,
    })

    // Register Purchasing forms
    for (const form of purchasingForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "purchasing",
      name: "Purchasing",
      description: "Purchase orders and requisitions",
      icon: "ShoppingBag",
      color: "teal",
      forms: purchasingForms,
    })

    // Register Projects forms
    for (const form of projectsForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "projects",
      name: "Projects",
      description: "Project and task management",
      icon: "FolderKanban",
      color: "cyan",
      forms: projectsForms,
    })

    // Register Documents forms
    for (const form of documentsForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "documents",
      name: "Documents",
      description: "Document management",
      icon: "File",
      color: "indigo",
      forms: documentsForms,
    })

    // Register Manufacturing forms
    for (const form of manufacturingForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "manufacturing",
      name: "Manufacturing",
      description: "BOM and work orders",
      icon: "Wrench",
      color: "amber",
      forms: manufacturingForms,
    })

    // Register Helpdesk forms
    for (const form of helpdeskForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "helpdesk",
      name: "Helpdesk",
      description: "Support tickets",
      icon: "LifeBuoy",
      color: "rose",
      forms: helpdeskForms,
    })

    // Register Expenses forms
    for (const form of expensesForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "expenses",
      name: "Expenses",
      description: "Expense tracking",
      icon: "Receipt",
      color: "emerald",
      forms: expensesForms,
    })

    // Register Calendar forms
    for (const form of calendarForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "calendar",
      name: "Calendar",
      description: "Events and scheduling",
      icon: "Calendar",
      color: "sky",
      forms: calendarForms,
    })

    // Register Subscriptions forms
    for (const form of subscriptionsForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "subscriptions",
      name: "Subscriptions",
      description: "Subscription management",
      icon: "RefreshCw",
      color: "violet",
      forms: subscriptionsForms,
    })

    // Register Proposals forms
    for (const form of proposalsForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "proposals",
      name: "Proposals",
      description: "Proposal management",
      icon: "FileText",
      color: "fuchsia",
      forms: proposalsForms,
    })

    // Register Reports forms
    for (const form of reportsForms) {
      this.registerForm(form)
    }
    this.registerModule({
      id: "reports",
      name: "Reports",
      description: "Report generation",
      icon: "BarChart",
      color: "slate",
      forms: reportsForms,
    })
  }

  private registerForm(entry: FormRegistryEntry) {
    const key = this.getKey(entry.moduleId, entry.formId)
    this.forms.set(key, entry)
  }

  private registerModule(metadata: FormModuleMetadata) {
    this.modules.set(metadata.id, metadata)
  }

  private getKey(moduleId: string, formId: string): string {
    return `${moduleId}:${formId}`
  }

  // Public API
  get(moduleId: string, formId: string): FormRegistryEntry | undefined {
    return this.forms.get(this.getKey(moduleId, formId))
  }

  getByModule(moduleId: string): FormRegistryEntry[] {
    return Array.from(this.forms.values())
      .filter(f => f.moduleId === moduleId)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  getAll(): FormRegistryEntry[] {
    return Array.from(this.forms.values())
      .sort((a, b) => {
        if (a.moduleId !== b.moduleId) {
          return a.moduleId.localeCompare(b.moduleId)
        }
        return a.name.localeCompare(b.name)
      })
  }

  getModules(): FormModuleMetadata[] {
    return Array.from(this.modules.values())
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  getModule(moduleId: string): FormModuleMetadata | undefined {
    return this.modules.get(moduleId)
  }

  has(moduleId: string, formId: string): boolean {
    return this.forms.has(this.getKey(moduleId, formId))
  }

  // Get default configuration for a form
  getDefaultConfig(moduleId: string, formId: string): DefaultFormConfiguration | undefined {
    const entry = this.get(moduleId, formId)
    if (!entry) return undefined
    return entry.defaultConfig()
  }

  // Search forms by name or description
  search(query: string): FormRegistryEntry[] {
    const lowerQuery = query.toLowerCase()
    return this.getAll().filter(
      f =>
        f.name.toLowerCase().includes(lowerQuery) ||
        f.description.toLowerCase().includes(lowerQuery) ||
        f.moduleId.toLowerCase().includes(lowerQuery)
    )
  }
}

// Singleton instance
export const formRegistry = new FormRegistry()

// ═════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═════════════════════════════════════════════════════════════════════════════

export function getFormEntry(moduleId: string, formId: string): FormRegistryEntry | undefined {
  return formRegistry.get(moduleId, formId)
}

export function getModuleForms(moduleId: string): FormRegistryEntry[] {
  return formRegistry.getByModule(moduleId)
}

export function getAllModules(): FormModuleMetadata[] {
  return formRegistry.getModules()
}

export function getAllForms(): FormRegistryEntry[] {
  return formRegistry.getAll()
}

export function getDefaultFormConfig(moduleId: string, formId: string): DefaultFormConfiguration | undefined {
  return formRegistry.getDefaultConfig(moduleId, formId)
}

export function searchForms(query: string): FormRegistryEntry[] {
  return formRegistry.search(query)
}

export function hasFormConfig(moduleId: string, formId: string): boolean {
  return formRegistry.has(moduleId, formId)
}
