import type {
  DispatchPresentationDestination,
  PresentationDestination,
  PresentationOutcome,
} from "./assistant-presentation-dispatcher"

export type WebMcpPresentationResult = { status: PresentationOutcome | "invalid_input" }

type WebMcpTool = {
  name: PresentationDestination["kind"]
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, { type: "string"; pattern: string }>
    required: string[]
    additionalProperties: false
  }
  execute(input: unknown, options?: { signal?: AbortSignal }): Promise<WebMcpPresentationResult>
}

export type WebMcpModelContext = {
  registerTool(tool: WebMcpTool, options: { signal: AbortSignal }): void | Promise<void>
}

export type WebMcpPresentationAvailability = {
  canOpenInventoryRecord: boolean
  canOpenImportReview: boolean
}

const INVENTORY_PRODUCT_ID = /^[1-9][0-9]{0,19}$/
const SAVED_IMPORT_TASK_ID = /^[a-f0-9]{32}$/

type ToolDescriptor = Pick<WebMcpTool, "name" | "description"> & {
  capability: keyof WebMcpPresentationAvailability
  argument: string
  pattern: RegExp
  destination: (id: string) => PresentationDestination
}

const tools: ToolDescriptor[] = [
  {
    capability: "canOpenInventoryRecord",
    name: "open_inventory_record",
    description: "Open the exact product from an inventory result in the current company.",
    argument: "productId",
    pattern: INVENTORY_PRODUCT_ID,
    destination: productId => ({ kind: "open_inventory_record", productId }),
  },
  {
    capability: "canOpenImportReview",
    name: "open_import_review",
    description: "Open a saved import's current review screen in the current company.",
    argument: "taskId",
    pattern: SAVED_IMPORT_TASK_ID,
    destination: taskId => ({ kind: "open_import_review", taskId }),
  },
]

function createTool(
  { name, description, argument, pattern, destination }: ToolDescriptor,
  scopeSignal: AbortSignal,
  dispatch: DispatchPresentationDestination,
): WebMcpTool {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { [argument]: { type: "string", pattern: pattern.source } },
      required: [argument],
      additionalProperties: false,
    },
    async execute(input, options) {
      if (scopeSignal.aborted) return { status: "scope_changed" }

      const executionSignal = options?.signal
      if (executionSignal?.aborted) return { status: "cancelled" }

      if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).length !== 1 || !Object.hasOwn(input, argument)) {
        return { status: "invalid_input" }
      }
      const id = (input as Record<string, unknown>)[argument]
      if (typeof id !== "string" || !pattern.test(id)) return { status: "invalid_input" }

      const signal = executionSignal ? AbortSignal.any([scopeSignal, executionSignal]) : scopeSignal
      let outcome: PresentationOutcome
      try {
        outcome = await dispatch(destination(id), { signal })
      } catch {
        outcome = "unavailable"
      }
      if (scopeSignal.aborted) return { status: "scope_changed" }
      if (executionSignal?.aborted) return { status: "cancelled" }
      return { status: outcome }
    },
  }
}

/** Register the presentation tools for one active document scope. */
export function registerAssistantWebMcpTools(
  modelContext: WebMcpModelContext | undefined,
  availability: WebMcpPresentationAvailability,
  dispatch: DispatchPresentationDestination,
): (() => void) | undefined {
  if (typeof modelContext?.registerTool !== "function") return
  if (!availability.canOpenInventoryRecord && !availability.canOpenImportReview) return

  const controller = new AbortController()
  const { signal } = controller
  const context = modelContext
  async function register(tool: WebMcpTool) {
    try {
      await context.registerTool(tool, { signal })
    } catch {
      // The document's permissions policy can deny registration. Chat remains available.
    }
  }
  for (const tool of tools) {
    if (availability[tool.capability]) void register(createTool(tool, signal, dispatch))
  }
  return () => controller.abort()
}
