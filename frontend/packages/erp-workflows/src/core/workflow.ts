/** Identity of a record workflow, e.g. `sales.order` over the `sale_order` table. */
export interface WorkflowDefinition {
  id: string
  /** Canonical table the workflow's records live in. */
  resource: string
  module: string
}

export function defineWorkflow<const T extends WorkflowDefinition>(definition: T): Readonly<T> {
  return Object.freeze({ ...definition })
}
