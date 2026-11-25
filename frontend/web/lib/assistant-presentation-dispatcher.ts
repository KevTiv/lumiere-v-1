import {
  ASSISTANT_PAGE_MODULES,
  assistantActionHref,
  decodeAssistantAction,
  getAssistantCapability,
  isAssistantPageAction,
  type AssistantAction,
  type AssistantActionScope,
  type AssistantCapability,
} from "@lumiere/query-hooks/assistant-actions"
import type { ChatNativeActionOutcome } from "@lumiere/ui/lib/ai-chat-types"
import type { RBACContext } from "@lumiere/ui/lib/rbac-types"
import type { useAssistantNativeForms } from "@lumiere/ui/components/assistant-native-form-provider"
import type { NavigationEditorContext } from "@lumiere/ui/forms/navigation-guard-context"
import type { ContextType } from "react"
import type { useModulePageComposition } from "./module-page-composition"

export type PresentationDestination =
  | { kind: "open_inventory_record"; productId: string }
  | { kind: "open_import_review"; taskId: string }

export type PresentationOutcome =
  | "requested"
  | "opened"
  | "cancelled"
  | "denied"
  | "scope_changed"
  | "unavailable"

export type DispatchPresentationDestination = (
  destination: PresentationDestination,
  options?: { signal?: AbortSignal },
) => Promise<PresentationOutcome>

type PresentationContext = Pick<
  RBACContext,
  "checkPermission" | "permissionsReady"
> & {
  actionScope: AssistantActionScope | null
  scopeKey: string | null
  allowedModules: readonly string[]
}

type PresentationPorts = {
  current: () => PresentationContext
  navigationGuard: ContextType<typeof NavigationEditorContext>
  push: (href: string) => void
  reveal: () => void
}

type ChatPresentationPorts = PresentationPorts & {
  nativeForms: ReturnType<typeof useAssistantNativeForms>
  pageComposition: () => ReturnType<typeof useModulePageComposition>
}

type PresentationFailure =
  | "cancelled"
  | "denied"
  | "scope_changed"
  | "unavailable"
type Validation<T> = { value: T } | { outcome: PresentationFailure }

export const PRESENTATION_DESTINATION_CAPABILITIES = {
  open_inventory_record: "products.product.open",
  open_import_review: "settings.imports.navigate",
} as const

function hasPermission(
  context: PresentationContext,
  capability: AssistantCapability,
): boolean {
  return Boolean(
    context.permissionsReady &&
    context.checkPermission(
      capability.permission.resource,
      capability.permission.action,
    ).allowed,
  )
}

export function canPresentDestination(
  context: PresentationContext,
  destination: PresentationDestination["kind"],
): boolean {
  const capability = getAssistantCapability(
    PRESENTATION_DESTINATION_CAPABILITIES[destination],
  )
  return Boolean(
    context.actionScope &&
    context.scopeKey &&
    capability &&
    context.allowedModules.includes(capability.module) &&
    hasPermission(context, capability),
  )
}

function present<T, Outcome extends ChatNativeActionOutcome>(
  validate: () => Validation<T>,
  open: (validated: T, settle: (outcome: Outcome) => void) => void,
  navigationGuard: PresentationPorts["navigationGuard"],
  signal?: AbortSignal,
): Promise<Outcome | PresentationFailure> {
  return new Promise((resolve, reject) => {
    const settle = (outcome: Outcome | PresentationFailure) => {
      signal?.removeEventListener("abort", cancel)
      resolve(outcome)
    }
    const cancel = () => settle("cancelled")
    if (signal?.aborted) return cancel()
    signal?.addEventListener("abort", cancel, { once: true })
    const perform = () => {
      if (signal?.aborted) return cancel()
      try {
        const current = validate()
        if ("outcome" in current) return settle(current.outcome)
        open(current.value, settle)
      } catch (error) {
        signal?.removeEventListener("abort", cancel)
        reject(error)
      }
    }
    if (navigationGuard) navigationGuard.proceed(perform, cancel)
    else perform()
  })
}

/** Present a capability offered by chat using its current native owner. */
export function dispatchAssistantPresentation(
  proposed: AssistantAction,
  ports: ChatPresentationPorts,
  options: {
    isCurrent: () => boolean
    origin?: { sessionKey: string; messageId: string }
  },
): Promise<ChatNativeActionOutcome> {
  const validate = () => {
    const current = ports.current()
    const action =
      current.actionScope &&
      decodeAssistantAction(proposed, current.actionScope, {
        allowedModules: current.allowedModules,
        allowedPageModules: ASSISTANT_PAGE_MODULES,
      })
    const capability = action && getAssistantCapability(action.capabilityKey)
    if (!options.isCurrent() || !action || !capability || !current.scopeKey) {
      return { outcome: "scope_changed" } as const
    }
    if (!hasPermission(current, capability))
      return { outcome: "denied" } as const
    return {
      value: { action, capability, scopeKey: current.scopeKey },
    } as const
  }
  const initial = validate()
  if ("outcome" in initial) return Promise.resolve(initial.outcome)
  const { action, capability } = initial.value
  const currentPage = ports.pageComposition()?.page
  const changesPage =
    !isAssistantPageAction(action) ||
    currentPage?.moduleId !== capability.module ||
    Boolean(action.pageId && currentPage?.pageId !== action.pageId)

  return present(
    validate,
    ({ action, capability, scopeKey }, settle) => {
      const href = assistantActionHref(action)
      if (!href) return settle("unavailable")
      if (isAssistantPageAction(action)) {
        const composer = ports.pageComposition()
        if (!composer) return settle("unavailable")
        const result = composer.requestPage({
          requestId: crypto.randomUUID(),
          scopeKey,
          moduleId: capability.module,
          pageId: action.pageId,
          kind: action.kind,
          widgetKey: action.widgetKey,
          prompt: action.prompt,
          origin:
            action.kind === "add_widget" && !action.widgetKey
              ? options.origin
              : undefined,
          onPresentationOutcome: settle,
        })
        if (result !== "pending") return settle(result)
        // Preserve the current date range and filters when editing this page.
        if (
          composer.page?.moduleId !== capability.module ||
          (action.pageId && composer.page.pageId !== action.pageId)
        ) {
          ports.push(href)
        }
      } else {
        const farmEventForm =
          capability.module === "farm-batches" &&
          action.kind === "prepare_workflow"
        if (action.kind === "open_form" || farmEventForm) {
          if (!ports.nativeForms || !capability.tab)
            return settle("unavailable")
          const result = ports.nativeForms.requestForm({
            requestId: crypto.randomUUID(),
            scopeKey,
            moduleId: capability.module,
            tabId: capability.tab,
            prompt: action.prompt,
            targetRecordId: farmEventForm ? action.recordId : undefined,
            onPresentationOutcome: settle,
          })
          if (result !== "pending") return settle(result)
        }
        ports.push(href)
        if (action.kind !== "open_form" && !farmEventForm) settle("requested")
      }
      ports.reveal()
    },
    changesPage ? ports.navigationGuard : null,
  )
}

/** Resolve a destination under the current actor and recheck after any asynchronous read or guard. */
export async function dispatchPresentationDestination(
  destination: PresentationDestination,
  ports: PresentationPorts & {
    readImportHref: (
      scope: AssistantActionScope,
      taskId: string,
      signal?: AbortSignal,
    ) => Promise<string>
  },
  signal?: AbortSignal,
): Promise<PresentationOutcome> {
  const currentScope = ports.current()
  const scope = currentScope.actionScope
  if (!scope || !currentScope.scopeKey) return "scope_changed"
  const validate = (): Validation<undefined> => {
    if (signal?.aborted) return { outcome: "cancelled" }
    const current = ports.current()
    if (
      current.scopeKey !== currentScope.scopeKey ||
      current.actionScope !== scope
    ) {
      return { outcome: "scope_changed" }
    }
    if (!canPresentDestination(current, destination.kind))
      return { outcome: "denied" }
    return { value: undefined }
  }
  const initial = validate()
  if ("outcome" in initial) return initial.outcome

  let href
  try {
    if (destination.kind === "open_inventory_record") {
      href = assistantActionHref({
        version: 1,
        kind: "open_record",
        capabilityKey:
          PRESENTATION_DESTINATION_CAPABILITIES.open_inventory_record,
        recordId: destination.productId,
        scope,
      })
    } else if (/^[0-9a-f]{32}$/.test(destination.taskId)) {
      href = await ports.readImportHref(scope, destination.taskId, signal)
    }
  } catch {
    const current = validate()
    return "outcome" in current ? current.outcome : "unavailable"
  }
  const current = validate()
  if ("outcome" in current) return current.outcome
  if (!href) return "unavailable"
  const target = href
  return present(
    validate,
    (_, settle: (outcome: "requested") => void) => {
      ports.push(target)
      ports.reveal()
      settle("requested")
    },
    ports.navigationGuard,
    signal,
  )
}
