import coverage from "./alpha-import-coverage.json" with { type: "json" }

export type AlphaImportAnchor = Readonly<{ path: string; marker: string }>

export type AlphaImportEntryPoint = AlphaImportAnchor & Readonly<{
  surface: string
  format: "csv_file_or_paste" | "csv_xlsx" | "saved_task"
  availability: "workspace_authority" | "wizard_profile" | "company_farm_pack" | "historical_payment_contract"
}>

type NativeScope = "organization" | "organization_currency" | "company"

export type AlphaImportNativePath =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "csv"; target: string; scope: NativeScope; gate?: AlphaImportAnchor }>
  | Readonly<{ kind: "specialized" | "intake"; anchor: AlphaImportAnchor; scope: NativeScope; gate?: AlphaImportAnchor }>

export type AlphaSavedTaskCoverage =
  | Readonly<{ state: "task_execution" | "native_preview" | "reviewed_records"; capability: string }>
  | Readonly<{ state: "evidence_only"; capability: string; reason: string; recovery: string }>
  | Readonly<{ state: "not_connected"; reason: string; recovery: string }>
  | Readonly<{ state: "intake_or_support"; capability: string; reason: string }>

export type AlphaImportCoverage = Readonly<{
  id: string
  module: string
  entryPoints: readonly AlphaImportEntryPoint[]
  native: AlphaImportNativePath
  savedTask: AlphaSavedTaskCoverage
  served: "unverified"
  evidence: readonly AlphaImportAnchor[]
}>

/** Baseline discovery evidence. Use the owning route to determine current eligibility or execution. */
export const alphaImportCoverage = coverage as readonly AlphaImportCoverage[]
