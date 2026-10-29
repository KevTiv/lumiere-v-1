import { i18n as uiI18n } from "@lumiere/i18n"
// Forensic Report Types for ERP Incident Analysis

export type IncidentSeverity = "critical" | "high" | "medium" | "low"
export type IncidentStatus = "open" | "investigating" | "resolved" | "closed"
export type IncidentCategory = 
  | "process-failure"
  | "system-error"
  | "data-discrepancy"
  | "compliance-issue"
  | "security-incident"
  | "performance-issue"
  | "customer-complaint"
  | "quality-defect"
  | "supply-chain"
  | "other"

export interface TimelineEvent {
  id: string
  timestamp: string
  description: string
  actor?: string
  type: "action" | "observation" | "discovery" | "resolution" | "escalation"
}

export interface RootCause {
  id: string
  category: "human" | "process" | "system" | "external" | "unknown"
  description: string
  contributing: boolean
  evidence?: string
}

export interface CorrectiveAction {
  id: string
  description: string
  assignee: string
  dueDate: string
  status: "pending" | "in-progress" | "completed" | "overdue"
  priority: "high" | "medium" | "low"
  completedDate?: string
  notes?: string
}

export interface ImpactAssessment {
  financial?: {
    estimated: number
    actual?: number
    currency: string
  }
  operational?: {
    downtime?: string
    affectedProcesses: string[]
    affectedUsers: number
  }
  reputational?: {
    customerAffected: boolean
    publicExposure: boolean
    description?: string
  }
  compliance?: {
    regulatoryImpact: boolean
    regulations?: string[]
    reportingRequired: boolean
  }
}

export interface Attachment {
  id: string
  name: string
  type: string
  size: number
  uploadedBy: string
  uploadedAt: string
  url?: string
}

export interface ForensicReport {
  id: string
  reportNumber: string
  title: string
  summary: string
  category: IncidentCategory
  severity: IncidentSeverity
  status: IncidentStatus
  
  // Dates
  incidentDate: string
  reportedDate: string
  resolvedDate?: string
  closedDate?: string
  
  // People
  reportedBy: string
  assignedTo: string
  teamMembers: string[]
  reviewedBy?: string
  approvedBy?: string
  
  // Details
  description: string
  timeline: TimelineEvent[]
  rootCauses: RootCause[]
  impact: ImpactAssessment
  
  // Actions
  immediateActions: string[]
  correctiveActions: CorrectiveAction[]
  preventiveActions: string[]
  lessonsLearned: string[]
  
  // Meta
  attachments: Attachment[]
  relatedReports?: string[]
  tags: string[]
  department: string
  
  createdAt: string
  updatedAt: string
}

// Category configuration with icons and colors
export const incidentCategories: Record<IncidentCategory, { label: string; color: string; description: string }> = {
  "process-failure": { get label() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.processFailure.label", { defaultValue: "Process Failure" }) }, color: "orange", get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.processFailure.description", { defaultValue: "Breakdown in standard operating procedures" }) } },
  "system-error": { get label() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.systemError.label", { defaultValue: "System Error" }) }, color: "red", get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.systemError.description", { defaultValue: "Technical system malfunction or bug" }) } },
  "data-discrepancy": { get label() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.dataDiscrepancy.label", { defaultValue: "Data Discrepancy" }) }, color: "yellow", get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.dataDiscrepancy.description", { defaultValue: "Inconsistent or incorrect data" }) } },
  "compliance-issue": { get label() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.complianceIssue.label", { defaultValue: "Compliance Issue" }) }, color: "purple", get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.complianceIssue.description", { defaultValue: "Regulatory or policy violation" }) } },
  "security-incident": { get label() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.securityIncident.label", { defaultValue: "Security Incident" }) }, color: "red", get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.securityIncident.description", { defaultValue: "Security breach or vulnerability" }) } },
  "performance-issue": { get label() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.performanceIssue.label", { defaultValue: "Performance Issue" }) }, color: "blue", get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.performanceIssue.description", { defaultValue: "System or process performance degradation" }) } },
  "customer-complaint": { get label() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.customerComplaint.label", { defaultValue: "Customer Complaint" }) }, color: "amber", get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.customerComplaint.description", { defaultValue: "Customer-reported issue" }) } },
  "quality-defect": { get label() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.qualityDefect.label", { defaultValue: "Quality Defect" }) }, color: "orange", get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.qualityDefect.description", { defaultValue: "Product or service quality issue" }) } },
  "supply-chain": { get label() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.supplyChain.label", { defaultValue: "Supply Chain" }) }, color: "teal", get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.supplyChain.description", { defaultValue: "Supply chain disruption or issue" }) } },
  "other": { get label() { return uiI18n.t("common.entityView.otherColumn", { defaultValue: "Other" }) }, color: "gray", get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.other.description", { defaultValue: "Uncategorized incident" }) } },
}

export const severityConfig: Record<IncidentSeverity, { label: string; color: string; description: string }> = {
  critical: { get label() { return uiI18n.t("forensics.view.critical", { defaultValue: "Critical" }) }, color: "red", get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.severityConfig.critical.description", { defaultValue: "Immediate action required, major business impact" }) } },
  high: { get label() { return uiI18n.t("forensics.view.filterSeverityHigh", { defaultValue: "High" }) }, color: "orange", get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.severityConfig.high.description", { defaultValue: "Urgent attention needed, significant impact" }) } },
  medium: { get label() { return uiI18n.t("forensics.view.filterSeverityMedium", { defaultValue: "Medium" }) }, color: "yellow", get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.severityConfig.medium.description", { defaultValue: "Requires timely resolution, moderate impact" }) } },
  low: { get label() { return uiI18n.t("forensics.view.filterSeverityLow", { defaultValue: "Low" }) }, color: "green", get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.severityConfig.low.description", { defaultValue: "Can be scheduled, minor impact" }) } },
}

export const statusConfig: Record<IncidentStatus, { label: string; color: string }> = {
  open: { get label() { return uiI18n.t("forensics.view.filterStatusOpen", { defaultValue: "Open" }) }, color: "red" },
  investigating: { get label() { return uiI18n.t("forensics.view.filterStatusInvestigating", { defaultValue: "Investigating" }) }, color: "yellow" },
  resolved: { get label() { return uiI18n.t("forensics.view.filterStatusResolved", { defaultValue: "Resolved" }) }, color: "blue" },
  closed: { get label() { return uiI18n.t("forensics.view.filterStatusClosed", { defaultValue: "Closed" }) }, color: "green" },
}

// Sample reports for demo
export const sampleForensicReports: ForensicReport[] = [
  {
    id: "FR-001",
    reportNumber: "INC-2024-0042",
    title: "Inventory Count Discrepancy - Warehouse A",
    summary: "Significant variance discovered between physical count and system records for SKU categories 100-150.",
    category: "data-discrepancy",
    severity: "high",
    status: "investigating",
    incidentDate: "2024-01-15T09:30:00Z",
    reportedDate: "2024-01-15T14:00:00Z",
    reportedBy: "Sarah Johnson",
    assignedTo: "Mike Chen",
    teamMembers: ["Sarah Johnson", "Mike Chen", "Lisa Wang"],
    description: "During the quarterly inventory audit, a discrepancy of 847 units was discovered across 23 SKUs in Warehouse A. The variance represents approximately $42,350 in inventory value. Initial investigation suggests the issue may be related to recent system migration.",
    timeline: [
      { id: "t1", timestamp: "2024-01-15T09:30:00Z", description: "Inventory audit commenced", actor: "Sarah Johnson", type: "action" },
      { id: "t2", timestamp: "2024-01-15T11:45:00Z", description: "Discrepancy first noticed in Section B-12", actor: "Sarah Johnson", type: "discovery" },
      { id: "t3", timestamp: "2024-01-15T13:00:00Z", description: "Full count comparison completed", actor: "Sarah Johnson", type: "observation" },
      { id: "t4", timestamp: "2024-01-15T14:00:00Z", description: "Incident escalated to management", actor: "Sarah Johnson", type: "escalation" },
    ],
    rootCauses: [
      { id: "rc1", category: "system", description: "Data migration script failed to transfer 3 batch records", contributing: true, evidence: "Log files from Jan 10 migration" },
      { id: "rc2", category: "process", description: "Manual adjustments not properly documented", contributing: true },
    ],
    impact: {
      financial: { estimated: 42350, currency: "USD" },
      operational: { affectedProcesses: ["Order Fulfillment", "Purchasing"], affectedUsers: 12 },
      compliance: { regulatoryImpact: false, reportingRequired: false },
    },
    immediateActions: [
      "Suspended automated reordering for affected SKUs",
      "Initiated manual verification of all Section B inventory",
    ],
    correctiveActions: [
      { id: "ca1", description: "Restore missing batch records from backup", assignee: "IT Team", dueDate: "2024-01-17", status: "in-progress", priority: "high" },
      { id: "ca2", description: "Reconcile physical vs system counts", assignee: "Warehouse Team", dueDate: "2024-01-20", status: "pending", priority: "high" },
    ],
    preventiveActions: [
      "Implement pre/post migration validation checks",
      "Add automated discrepancy alerts for variances > 5%",
    ],
    lessonsLearned: [],
    attachments: [],
    tags: ["inventory", "data-migration", "warehouse-a"],
    department: "Operations",
    createdAt: "2024-01-15T14:00:00Z",
    updatedAt: "2024-01-16T09:00:00Z",
  },
  {
    id: "FR-002",
    reportNumber: "INC-2024-0041",
    title: "Order Processing Delay - Payment Gateway Timeout",
    summary: "Payment gateway experienced intermittent timeouts causing 156 orders to fail processing.",
    category: "system-error",
    severity: "critical",
    status: "resolved",
    incidentDate: "2024-01-14T16:00:00Z",
    reportedDate: "2024-01-14T16:30:00Z",
    resolvedDate: "2024-01-14T19:45:00Z",
    reportedBy: "Tom Wilson",
    assignedTo: "David Park",
    teamMembers: ["Tom Wilson", "David Park", "Emma Davis"],
    reviewedBy: "John Smith",
    description: "The primary payment gateway provider experienced service degradation resulting in timeout errors. Approximately 156 customer orders failed to process during the 3.75 hour window. Customer support received 47 complaints.",
    timeline: [
      { id: "t1", timestamp: "2024-01-14T16:00:00Z", description: "First timeout error logged", type: "discovery" },
      { id: "t2", timestamp: "2024-01-14T16:15:00Z", description: "Error rate exceeded threshold, alert triggered", type: "observation" },
      { id: "t3", timestamp: "2024-01-14T16:30:00Z", description: "Incident reported and team mobilized", actor: "Tom Wilson", type: "escalation" },
      { id: "t4", timestamp: "2024-01-14T17:00:00Z", description: "Switched to backup payment processor", actor: "David Park", type: "action" },
      { id: "t5", timestamp: "2024-01-14T19:45:00Z", description: "Primary gateway restored, all systems normal", type: "resolution" },
    ],
    rootCauses: [
      { id: "rc1", category: "external", description: "Payment provider infrastructure failure", contributing: true, evidence: "Provider incident report #PGW-2024-0891" },
    ],
    impact: {
      financial: { estimated: 23400, actual: 18200, currency: "USD" },
      operational: { downtime: "3h 45m", affectedProcesses: ["Checkout", "Order Processing"], affectedUsers: 156 },
      reputational: { customerAffected: true, publicExposure: false, description: "47 customer complaints received" },
    },
    immediateActions: [
      "Activated backup payment processor",
      "Customer support team notified and briefed",
      "Affected customers contacted with apology and 10% discount code",
    ],
    correctiveActions: [
      { id: "ca1", description: "Implement automatic failover to backup processor", assignee: "Engineering", dueDate: "2024-01-25", status: "completed", priority: "high", completedDate: "2024-01-23" },
      { id: "ca2", description: "Reprocess failed orders", assignee: "Operations", dueDate: "2024-01-16", status: "completed", priority: "high", completedDate: "2024-01-15" },
    ],
    preventiveActions: [
      "Configure automatic failover with 30-second threshold",
      "Add secondary backup payment provider",
      "Implement real-time payment success rate monitoring",
    ],
    lessonsLearned: [
      "Need faster failover mechanism for critical third-party services",
      "Customer communication templates should be pre-prepared for common scenarios",
    ],
    attachments: [],
    tags: ["payment", "gateway", "outage", "customer-impact"],
    department: "IT",
    createdAt: "2024-01-14T16:30:00Z",
    updatedAt: "2024-01-16T10:00:00Z",
  },
  {
    id: "FR-003",
    reportNumber: "INC-2024-0038",
    title: "Quality Control Failure - Batch #2024-0112",
    summary: "Product batch failed quality inspection due to incorrect material composition.",
    category: "quality-defect",
    severity: "high",
    status: "closed",
    incidentDate: "2024-01-10T08:00:00Z",
    reportedDate: "2024-01-10T10:30:00Z",
    resolvedDate: "2024-01-12T16:00:00Z",
    closedDate: "2024-01-15T09:00:00Z",
    reportedBy: "Jennifer Lee",
    assignedTo: "Robert Martinez",
    teamMembers: ["Jennifer Lee", "Robert Martinez", "Amy Chen"],
    reviewedBy: "John Smith",
    approvedBy: "Mary Johnson",
    description: "Batch #2024-0112 failed final quality inspection. Lab analysis revealed material composition variance of 8% from specification. Root cause traced to supplier material substitution without notification.",
    timeline: [
      { id: "t1", timestamp: "2024-01-10T08:00:00Z", description: "Quality inspection initiated", actor: "Jennifer Lee", type: "action" },
      { id: "t2", timestamp: "2024-01-10T09:15:00Z", description: "Visual inspection passed", type: "observation" },
      { id: "t3", timestamp: "2024-01-10T10:00:00Z", description: "Lab analysis revealed composition variance", type: "discovery" },
      { id: "t4", timestamp: "2024-01-10T10:30:00Z", description: "Batch quarantined, incident reported", actor: "Jennifer Lee", type: "escalation" },
      { id: "t5", timestamp: "2024-01-11T14:00:00Z", description: "Supplier confirmed material substitution", type: "observation" },
      { id: "t6", timestamp: "2024-01-12T16:00:00Z", description: "Replacement batch produced and approved", type: "resolution" },
    ],
    rootCauses: [
      { id: "rc1", category: "external", description: "Supplier substituted material without notification", contributing: true, evidence: "Supplier admission email dated Jan 11" },
      { id: "rc2", category: "process", description: "Incoming material inspection did not include composition testing", contributing: true },
    ],
    impact: {
      financial: { estimated: 35000, actual: 28500, currency: "USD" },
      operational: { affectedProcesses: ["Production", "Shipping"], affectedUsers: 8 },
      compliance: { regulatoryImpact: false, reportingRequired: false },
    },
    immediateActions: [
      "Quarantined affected batch",
      "Halted production using same material lot",
      "Expedited replacement material order",
    ],
    correctiveActions: [
      { id: "ca1", description: "Add composition testing to incoming inspection", assignee: "QC Team", dueDate: "2024-01-20", status: "completed", priority: "high", completedDate: "2024-01-18" },
      { id: "ca2", description: "Update supplier agreement with notification requirements", assignee: "Procurement", dueDate: "2024-01-25", status: "completed", priority: "medium", completedDate: "2024-01-24" },
    ],
    preventiveActions: [
      "Implement supplier change notification protocol",
      "Add random composition spot-checks to incoming materials",
      "Create approved material substitution list",
    ],
    lessonsLearned: [
      "Supplier agreements must explicitly require change notification",
      "Incoming inspection should include periodic composition verification",
      "Need backup suppliers for critical materials",
    ],
    attachments: [],
    tags: ["quality", "supplier", "material", "batch-failure"],
    department: "Quality Assurance",
    createdAt: "2024-01-10T10:30:00Z",
    updatedAt: "2024-01-15T09:00:00Z",
  },
]

// Report templates for quick creation
export interface ReportTemplate {
  id: string
  name: string
  category: IncidentCategory
  description: string
  defaultSeverity: IncidentSeverity
  suggestedRootCauses: string[]
  suggestedActions: string[]
}

export const reportTemplates: ReportTemplate[] = [
  {
    id: "tpl-inventory",
    get name() { return uiI18n.t("forensics.builtIn.forensicReportTypes.reportTemplates.tplInventory.name", { defaultValue: "Inventory Discrepancy" }) },
    category: "data-discrepancy",
    get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.reportTemplates.tplInventory.description", { defaultValue: "Template for inventory count variances" }) },
    defaultSeverity: "medium",
    suggestedRootCauses: [
      "System sync failure",
      "Manual entry error",
      "Theft or shrinkage",
      "Receiving errors",
      "Shipping errors",
    ],
    suggestedActions: [
      "Conduct physical recount",
      "Review transaction logs",
      "Check receiving records",
      "Verify shipping manifests",
    ],
  },
  {
    id: "tpl-system",
    get name() { return uiI18n.t("forensics.builtIn.forensicReportTypes.reportTemplates.tplSystem.name", { defaultValue: "System Outage" }) },
    category: "system-error",
    get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.reportTemplates.tplSystem.description", { defaultValue: "Template for system failures and outages" }) },
    defaultSeverity: "high",
    suggestedRootCauses: [
      "Hardware failure",
      "Software bug",
      "Network issue",
      "Third-party service failure",
      "Capacity exceeded",
    ],
    suggestedActions: [
      "Activate backup systems",
      "Notify affected users",
      "Engage vendor support",
      "Document timeline",
    ],
  },
  {
    id: "tpl-quality",
    get name() { return uiI18n.t("forensics.builtIn.forensicReportTypes.reportTemplates.tplQuality.name", { defaultValue: "Quality Issue" }) },
    category: "quality-defect",
    get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.reportTemplates.tplQuality.description", { defaultValue: "Template for product quality problems" }) },
    defaultSeverity: "high",
    suggestedRootCauses: [
      "Material defect",
      "Process deviation",
      "Equipment malfunction",
      "Human error",
      "Environmental factors",
    ],
    suggestedActions: [
      "Quarantine affected items",
      "Stop production line",
      "Conduct root cause analysis",
      "Notify quality team",
    ],
  },
  {
    id: "tpl-customer",
    get name() { return uiI18n.t("forensics.builtIn.forensicReportTypes.incidentCategories.customerComplaint.label", { defaultValue: "Customer Complaint" }) },
    category: "customer-complaint",
    get description() { return uiI18n.t("forensics.builtIn.forensicReportTypes.reportTemplates.tplCustomer.description", { defaultValue: "Template for customer-reported issues" }) },
    defaultSeverity: "medium",
    suggestedRootCauses: [
      "Product defect",
      "Service failure",
      "Communication breakdown",
      "Delivery issue",
      "Billing error",
    ],
    suggestedActions: [
      "Contact customer immediately",
      "Document complaint details",
      "Investigate internally",
      "Prepare resolution options",
    ],
  },
]

// Analytics types
export interface ForensicAnalytics {
  totalReports: number
  openReports: number
  avgResolutionTime: number // in hours
  bySeverity: Record<IncidentSeverity, number>
  byCategory: Record<IncidentCategory, number>
  byStatus: Record<IncidentStatus, number>
  byDepartment: Record<string, number>
  trendsLastMonth: { date: string; count: number }[]
  topRootCauses: { cause: string; count: number }[]
}
