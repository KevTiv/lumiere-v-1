import type { DashboardSection } from "./dashboard-types"
import type { EntityViewConfig } from "./entity-view-types"
import type { FormConfig } from "./form-types"

export interface ModuleTab {
  id: string
  label: string
  type: "dashboard" | "entity"
  /** For type='dashboard': sections rendered by DashboardGrid */
  sections?: DashboardSection[]
  /** For type='entity': EntityView config */
  entityConfig?: EntityViewConfig
  /** Optional 'New X' button that opens a FormModal */
  createForm?: FormConfig
  /** Label for the create button, e.g. 'New Invoice' */
  createLabel?: string
  /** Identifier passed to onFormSubmit so callers know which mutation to invoke */
  createAction?: string
}

export interface ModuleConfig {
  id: string
  title: string
  description?: string
  defaultTab?: string
  tabs: ModuleTab[]
}
