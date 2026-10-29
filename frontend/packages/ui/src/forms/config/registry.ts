import { i18n } from "@lumiere/i18n"
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
    get name() { return i18n.t("forms.defaults.journal.dailyJournal") },
    get description() { return i18n.t("journal.formDefaults.dailyWorkJournalForTrackingProgressAndReflections") },
    icon: "BookMarked",
    get category() { return i18n.t("forms.defaults.journal.productivity") },
    defaultConfig: () => ({
      moduleId: "journal",
      formId: "daily-entry",
      get name() { return i18n.t("forms.defaults.journal.dailyJournal") },
      get description() { return i18n.t("journal.formDefaults.dailyWorkJournalForTrackingProgressAndReflections") },
      isSystemDefault: true,
      fields: [
        {
          fieldId: "mood",
          name: "mood",
          get label() { return i18n.t("journal.formDefaults.howWasYourDay") },
          fieldType: "Radio",
          options: [
            { value: "great", get label() { return i18n.t("journal.formDefaults.great") }, color: "green", icon: "star" },
            { value: "good", get label() { return i18n.t("journal.formDefaults.good") }, color: "teal", icon: "smile" },
            { value: "neutral", get label() { return i18n.t("journal.formDefaults.neutral") }, color: "yellow", icon: "meh" },
            { value: "challenging", get label() { return i18n.t("journal.formDefaults.challenging") }, color: "orange", icon: "frown" },
            { value: "difficult", get label() { return i18n.t("journal.formDefaults.difficult") }, color: "red", icon: "cloud" },
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
          get label() { return i18n.t("journal.formDefaults.whatDidYouAccomplishToday") },
          fieldType: "Textarea",
          get placeholder() { return i18n.t("journal.formDefaults.describeYourKeyAccomplishments") },
          validation: { required: true, minLength: 10 },
          get aiSuggestions() { return [i18n.t("forms.defaults.journal.suggestions.completedAssignedTasks"), i18n.t("forms.defaults.journal.suggestions.madeProgressOnProject"), i18n.t("forms.defaults.journal.suggestions.helpedAColleague")] },
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
          get label() { return i18n.t("journal.formDefaults.whatChallengesDidYouFace") },
          fieldType: "Textarea",
          get placeholder() { return i18n.t("journal.formDefaults.describeAnyObstaclesOrDifficulties") },
          validation: { required: false },
          get aiSuggestions() { return [i18n.t("forms.defaults.journal.suggestions.technicalIssue"), i18n.t("forms.defaults.journal.suggestions.timeConstraint"), i18n.t("forms.defaults.journal.suggestions.communicationGap")] },
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
          get label() { return i18n.t("journal.formDefaults.whatDidYouLearn") },
          fieldType: "Textarea",
          get placeholder() { return i18n.t("journal.formDefaults.anyNewInsightsOrKnowledge") },
          validation: { required: false },
          get aiSuggestions() { return [i18n.t("forms.defaults.journal.suggestions.newSkill"), i18n.t("forms.defaults.journal.suggestions.processImprovement"), i18n.t("forms.defaults.journal.suggestions.industryInsight")] },
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
          get label() { return i18n.t("journal.formDefaults.whatSYourFocusForTomorrow") },
          fieldType: "Textarea",
          get placeholder() { return i18n.t("journal.formDefaults.planYourPriorities") },
          validation: { required: false },
          get aiSuggestions() { return [i18n.t("forms.defaults.journal.suggestions.completePendingTasks"), i18n.t("forms.defaults.journal.suggestions.startNewProject"), i18n.t("forms.defaults.journal.suggestions.followUpOnItems")] },
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
          get label() { return i18n.t("journal.formDefaults.energyLevel") },
          fieldType: "Slider",
          get description() { return i18n.t("journal.formDefaults.rateYourEnergyLevel110") },
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
          get label() { return i18n.t("journal.formDefaults.productivityScore") },
          fieldType: "Rating",
          get description() { return i18n.t("journal.formDefaults.rateYourProductivity15Stars") },
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
          get label() { return i18n.t("settings.formConfig.fieldDialog.fieldTypes.Tags") },
          fieldType: "Tags",
          get placeholder() { return i18n.t("journal.formDefaults.addRelevantTags") },
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
    get name() { return i18n.t("forms.defaults.registry.incidentReport") },
    get description() { return i18n.t("forms.defaults.registry.forensicIncidentReportForTrackingAndAnalyzingIssues") },
    icon: "FileSearch",
    get category() { return i18n.t("forms.defaults.registry.compliance") },
    defaultConfig: () => ({
      moduleId: "forensic",
      formId: "incident-report",
      get name() { return i18n.t("forms.defaults.registry.incidentReport") },
      get description() { return i18n.t("forms.defaults.registry.forensicIncidentReportForTrackingAndAnalyzingIssues") },
      isSystemDefault: true,
      fields: [
        {
          fieldId: "title",
          name: "title",
          get label() { return i18n.t("forms.defaults.registry.incidentTitle") },
          fieldType: "Text",
          get placeholder() { return i18n.t("forms.defaults.registry.briefDescriptionOfTheIncident") },
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
          get label() { return i18n.t("forms.defaults.registry.category") },
          fieldType: "Select",
          options: [
            { value: "process-failure", get label() { return i18n.t("forms.defaults.registry.processFailure") }, color: "orange" },
            { value: "system-error", get label() { return i18n.t("forms.defaults.registry.systemError") }, color: "red" },
            { value: "data-discrepancy", get label() { return i18n.t("forms.defaults.registry.dataDiscrepancy") }, color: "yellow" },
            { value: "compliance-issue", get label() { return i18n.t("forms.defaults.registry.complianceIssue") }, color: "purple" },
            { value: "security-incident", get label() { return i18n.t("forms.defaults.registry.securityIncident") }, color: "red" },
            { value: "performance-issue", get label() { return i18n.t("forms.defaults.registry.performanceIssue") }, color: "blue" },
            { value: "customer-complaint", get label() { return i18n.t("forms.defaults.registry.customerComplaint") }, color: "amber" },
            { value: "quality-defect", get label() { return i18n.t("forms.defaults.registry.qualityDefect") }, color: "orange" },
            { value: "supply-chain", get label() { return i18n.t("forms.defaults.registry.supplyChain") }, color: "teal" },
            { value: "other", get label() { return i18n.t("common.entityView.otherColumn") }, color: "gray" },
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
          get label() { return i18n.t("forms.defaults.registry.severity") },
          fieldType: "Radio",
          options: [
            { value: "critical", get label() { return i18n.t("forms.defaults.registry.critical") }, color: "red" },
            { value: "high", get label() { return i18n.t("forms.defaults.registry.high") }, color: "orange" },
            { value: "medium", get label() { return i18n.t("forms.defaults.registry.medium") }, color: "yellow" },
            { value: "low", get label() { return i18n.t("forms.defaults.registry.low") }, color: "green" },
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
          get label() { return i18n.t("forms.defaults.registry.incidentDate") },
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
          get label() { return i18n.t("forms.defaults.registry.description") },
          fieldType: "Textarea",
          get placeholder() { return i18n.t("forms.defaults.registry.detailedDescriptionOfTheIncident") },
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
          get label() { return i18n.t("forms.defaults.registry.affectedArea") },
          fieldType: "MultiSelect",
          options: [
            { value: "production", get label() { return i18n.t("forms.defaults.registry.production") } },
            { value: "warehouse", get label() { return i18n.t("forms.defaults.registry.warehouse") } },
            { value: "sales", get label() { return i18n.t("forms.defaults.registry.sales") } },
            { value: "customer-service", get label() { return i18n.t("forms.defaults.registry.customerService") } },
            { value: "finance", get label() { return i18n.t("forms.defaults.registry.finance") } },
            { value: "it", get label() { return i18n.t("forms.defaults.registry.itSystems") } },
            { value: "logistics", get label() { return i18n.t("forms.defaults.registry.logistics") } },
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
          get label() { return i18n.t("forms.defaults.registry.immediateActionsTaken") },
          fieldType: "Textarea",
          get placeholder() { return i18n.t("forms.defaults.registry.whatActionsWereTakenImmediately") },
          validation: { required: false },
          get aiSuggestions() { return [i18n.t("forms.defaults.registry.suggestions.isolatedAffectedSystem"), i18n.t("forms.defaults.registry.suggestions.notifiedStakeholders"), i18n.t("forms.defaults.registry.suggestions.initiatedBackupProcedures"), i18n.t("forms.defaults.registry.suggestions.documentedInitialFindings")] },
          order: 7,
          isSystem: true,
          isEnabled: true,
          showInList: false,
          width: "Full",
        },
        {
          fieldId: "root_cause",
          name: "root_cause",
          get label() { return i18n.t("forms.defaults.registry.rootCauseAnalysis") },
          fieldType: "Textarea",
          get placeholder() { return i18n.t("forms.defaults.registry.initialAssessmentOfRootCause") },
          validation: { required: false },
          get aiSuggestions() { return [i18n.t("forms.defaults.registry.suggestions.humanError"), i18n.t("forms.defaults.registry.suggestions.systemMalfunction"), i18n.t("forms.defaults.registry.suggestions.processGap"), i18n.t("forms.defaults.registry.suggestions.externalFactor"), i18n.t("forms.defaults.registry.suggestions.communicationBreakdown")] },
          order: 8,
          isSystem: true,
          isEnabled: true,
          showInList: false,
          width: "Full",
        },
        {
          fieldId: "financial_impact",
          name: "financial_impact",
          get label() { return i18n.t("forms.defaults.registry.estimatedFinancialImpact") },
          fieldType: "Number",
          get placeholder() { return i18n.t("forms.defaults.registry.enterAmountInDollars") },
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
          get label() { return i18n.t("forms.defaults.registry.customersAffected") },
          fieldType: "Number",
          get placeholder() { return i18n.t("forms.defaults.registry.numberOfAffectedCustomers") },
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
          get label() { return i18n.t("forms.defaults.registry.assignTo") },
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
          get label() { return i18n.t("forms.defaults.registry.department") },
          fieldType: "Select",
          options: [
            { value: "operations", get label() { return i18n.t("forms.defaults.registry.operations") } },
            { value: "it", get label() { return i18n.t("forms.defaults.registry.it") } },
            { value: "sales", get label() { return i18n.t("forms.defaults.registry.sales") } },
            { value: "warehouse", get label() { return i18n.t("forms.defaults.registry.warehouse") } },
            { value: "quality", get label() { return i18n.t("forms.defaults.registry.qualityAssurance") } },
            { value: "finance", get label() { return i18n.t("forms.defaults.registry.finance") } },
            { value: "hr", get label() { return i18n.t("forms.defaults.registry.humanResources") } },
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
          get label() { return i18n.t("forms.defaults.registry.tags") },
          fieldType: "Tags",
          get placeholder() { return i18n.t("forms.defaults.registry.addRelevantTags") },
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
          get label() { return i18n.t("forms.defaults.registry.attachments") },
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
      get name() { return i18n.t("forms.defaults.registry.journal") },
      get description() { return i18n.t("journal.formDefaults.dailyWorkJournalsAndNotes") },
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
      get name() { return i18n.t("forms.defaults.registry.forensicReports") },
      get description() { return i18n.t("forms.defaults.registry.incidentTrackingAndForensicAnalysis") },
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
      get name() { return i18n.t("forms.defaults.registry.crm") },
      get description() { return i18n.t("forms.defaults.registry.customerRelationshipManagement") },
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
      get name() { return i18n.t("forms.defaults.registry.sales") },
      get description() { return i18n.t("forms.defaults.registry.salesOrdersAndPriceManagement") },
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
      get name() { return i18n.t("forms.defaults.registry.inventory") },
      get description() { return i18n.t("forms.defaults.registry.productAndStockManagement") },
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
      get name() { return i18n.t("forms.defaults.registry.accounting") },
      get description() { return i18n.t("journal.formDefaults.invoicesAndFinancialManagement") },
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
      get name() { return i18n.t("forms.defaults.registry.hr") },
      get description() { return i18n.t("forms.defaults.registry.humanResourcesManagement") },
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
      get name() { return i18n.t("forms.defaults.registry.purchasing") },
      get description() { return i18n.t("forms.defaults.registry.purchaseOrdersAndRequisitions") },
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
      get name() { return i18n.t("forms.defaults.registry.projects") },
      get description() { return i18n.t("forms.defaults.registry.projectAndTaskManagement") },
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
      get name() { return i18n.t("forms.defaults.registry.documents") },
      get description() { return i18n.t("journal.formDefaults.documentManagement") },
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
      get name() { return i18n.t("forms.defaults.registry.manufacturing") },
      get description() { return i18n.t("forms.defaults.registry.bomAndWorkOrders") },
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
      get name() { return i18n.t("forms.defaults.registry.helpdesk") },
      get description() { return i18n.t("forms.defaults.registry.supportTickets") },
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
      get name() { return i18n.t("forms.defaults.registry.expenses") },
      get description() { return i18n.t("journal.formDefaults.expenseTracking") },
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
      get name() { return i18n.t("forms.defaults.registry.calendar") },
      get description() { return i18n.t("journal.formDefaults.eventsAndScheduling") },
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
      get name() { return i18n.t("forms.defaults.registry.subscriptions") },
      get description() { return i18n.t("forms.defaults.registry.subscriptionManagement") },
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
      get name() { return i18n.t("forms.defaults.registry.proposals") },
      get description() { return i18n.t("forms.defaults.registry.proposalManagement") },
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
      get name() { return i18n.t("forms.defaults.registry.reports") },
      get description() { return i18n.t("journal.formDefaults.reportGeneration") },
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
