// Proposal / Tender Workspace Types

export type ProposalStatus = "draft" | "review" | "submitted" | "awarded" | "rejected" | "archived"

export type SectionStatus = "empty" | "draft" | "complete" | "reviewed"

export type FindingRelevance = "high" | "medium" | "low"

// ─── Source Documents ────────────────────────────────────────────────────────

export interface SourceDocument {
  id: string
  name: string
  content: string
  type: "pasted" | "uploaded"
  wordCount: number
  addedAt: Date
}

// ─── AI Analysis ─────────────────────────────────────────────────────────────

export interface Finding {
  id: string
  title: string
  excerpt: string
  relevance: FindingRelevance
  category: string
  page?: number
}

export interface Requirement {
  id: string
  text: string
  category: string
  mandatory: boolean
  addressed: boolean
}

export interface EvaluationCriterion {
  id: string
  name: string
  weight: number // percentage
  description: string
  addressed: boolean
}

export interface Concept {
  id: string
  term: string
  definition: string
  frequency: number
}

export interface AIAnalysis {
  summary: string
  keyFindings: Finding[]
  requirements: Requirement[]
  evaluationCriteria: EvaluationCriterion[]
  concepts: Concept[]
  suggestedSections: string[]
  analyzedAt: Date
}

// ─── Tender Draft ─────────────────────────────────────────────────────────────

export interface TenderSection {
  id: string
  title: string
  content: string
  status: SectionStatus
  aiSuggestion: string | null
  order: number
  wordCount: number
}

// ─── Version Control ──────────────────────────────────────────────────────────

export interface VersionLine {
  type: "added" | "removed" | "unchanged"
  text: string
}

export interface SectionDiff {
  sectionId: string
  sectionTitle: string
  lines: VersionLine[]
  hasChanges: boolean
}

export interface VersionDiff {
  sectionDiffs: SectionDiff[]
  sectionsAdded: string[]
  sectionsRemoved: string[]
  totalLinesAdded: number
  totalLinesRemoved: number
}

export interface ProposalVersion {
  id: string
  versionNumber: number
  message: string
  author: string
  createdAt: Date
  sections: TenderSection[]
  diff: VersionDiff | null // diff relative to previous version
}

// ─── Workspace State ──────────────────────────────────────────────────────────

export interface WorkspaceState {
  proposalId: string
  proposalTitle: string
  status: ProposalStatus
  sources: SourceDocument[]
  analysis: AIAnalysis | null
  isAnalyzing: boolean
  analyzeError: string | null
  sections: TenderSection[]
  versions: ProposalVersion[]
  activeVersionId: string | null
  isDirty: boolean
}

export type WorkspaceAction =
  | { type: "ADD_SOURCE"; source: SourceDocument }
  | { type: "REMOVE_SOURCE"; id: string }
  | { type: "UPDATE_SOURCE_CONTENT"; id: string; content: string }
  | { type: "SET_ANALYZING"; value: boolean }
  | { type: "SET_ANALYSIS"; analysis: AIAnalysis }
  | { type: "SET_ANALYZE_ERROR"; error: string }
  | { type: "SET_SECTIONS"; sections: TenderSection[] }
  | { type: "UPDATE_SECTION"; id: string; updates: Partial<TenderSection> }
  | { type: "ADD_SECTION"; section: TenderSection }
  | { type: "REMOVE_SECTION"; id: string }
  | { type: "MOVE_SECTION"; id: string; direction: "up" | "down" }
  | { type: "DUPLICATE_SECTION"; id: string }
  | { type: "SAVE_VERSION"; message: string; author: string }
  | { type: "RESTORE_VERSION"; versionId: string }
  | { type: "SET_ACTIVE_VERSION"; id: string | null }
  | { type: "SET_STATUS"; status: ProposalStatus }
  | { type: "SET_DIRTY"; value: boolean }

// ─── Predefined Section Templates ────────────────────────────────────────────

export const SECTION_TEMPLATES: { id: string; title: string; placeholder: string }[] = [
  {
    id: "executive-summary",
    title: "Executive Summary",
    placeholder:
      "Provide a concise overview of your proposal, highlighting your understanding of the requirements and your key value proposition...",
  },
  {
    id: "company-profile",
    title: "Company Profile",
    placeholder:
      "Describe your organisation, its history, size, capabilities, and relevant experience in this domain...",
  },
  {
    id: "technical-approach",
    title: "Technical Approach",
    placeholder:
      "Detail your methodology, technical solution, and how it addresses each stated requirement...",
  },
  {
    id: "project-timeline",
    title: "Project Timeline & Milestones",
    placeholder:
      "Outline the proposed schedule, key milestones, deliverables, and dependencies...",
  },
  {
    id: "team-qualifications",
    title: "Team & Qualifications",
    placeholder:
      "Present the project team, their roles, relevant credentials, and prior experience...",
  },
  {
    id: "pricing",
    title: "Pricing & Commercial Terms",
    placeholder:
      "Provide itemised pricing, payment schedule, and any commercial assumptions...",
  },
  {
    id: "compliance",
    title: "Compliance & Certifications",
    placeholder:
      "List relevant certifications, compliance standards met, and regulatory adherence...",
  },
  {
    id: "risk-management",
    title: "Risk Management",
    placeholder:
      "Identify key risks and your mitigation strategies for each...",
  },
  {
    id: "annexes",
    title: "Annexes & Supporting Documents",
    placeholder: "Reference any supporting documents, case studies, or appendices included...",
  },
]

// ─── Proposal List (for module list view) ────────────────────────────────────

export interface ProposalRecord {
  id: string
  title: string
  clientName: string
  status: ProposalStatus
  value: number
  deadline: string | null
  owner: string
  versionCount: number
  createdAt: string
  updatedAt: string
}
