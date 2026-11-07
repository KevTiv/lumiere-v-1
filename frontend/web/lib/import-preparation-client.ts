import { z } from "zod"
import {
  importPreparationIdentity,
  importPreparationSchema,
  importRecipeSchema,
  type ImportPreparation,
  type ImportRecipe,
} from "./import-preparation"
import {
  parseSavedImportTask,
  type ChatImportTask,
  type ImportTaskFetch,
} from "./chat-import-task"

export interface PreparationScope {
  companyId: number
  taskId: string
  organizationId?: number
  actor?: string
}

class PreparationRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function scopeQuery(scope: PreparationScope): string {
  if (
    !Number.isSafeInteger(scope.companyId) ||
    scope.companyId < 1 ||
    !/^[a-f0-9]{32}$/.test(scope.taskId) ||
    (scope.organizationId !== undefined &&
      (!Number.isSafeInteger(scope.organizationId) ||
        scope.organizationId < 1)) ||
    (scope.actor !== undefined && !scope.actor)
  )
    throw new Error("Select a saved import in the current company.")
  return `companyId=${scope.companyId}`
}

async function request(
  fetcher: ImportTaskFetch,
  url: string,
  body?: object,
): Promise<unknown> {
  const response = await fetcher(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  )
  const value: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(value)
    throw new PreparationRequestError(
      error.success
        ? error.data.error
        : "Preparation could not be checked. Retry the same saved choices.",
      response.status,
    )
  }
  return value
}

async function requestKey(
  action: string,
  scope: PreparationScope,
  payload: unknown,
): Promise<string> {
  scopeQuery(scope)
  const identity = {
    action,
    organizationId: scope.organizationId,
    actor: scope.actor,
    companyId: scope.companyId,
    taskId: scope.taskId,
    payload,
  }
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(identity)),
  )
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  )
    .join("")
    .slice(0, 32)
}

/** A transport error never creates a second request or silently changes choices. */
async function postWithReceipt<T>(
  fetcher: ImportTaskFetch,
  url: string,
  body: object,
  receiptUrl: string,
  validate: (value: unknown) => T,
): Promise<T> {
  try {
    return validate(await request(fetcher, url, body))
  } catch (cause) {
    if (
      cause instanceof PreparationRequestError &&
      cause.status < 500 &&
      ![408, 429].includes(cause.status)
    )
      throw cause
    try {
      return validate(await request(fetcher, receiptUrl))
    } catch {
      throw new Error(
        "The preparation outcome is still unknown. Retry these same choices to recover the saved request; changing them starts a different request.",
        { cause },
      )
    }
  }
}

function preparedTask(
  value: unknown,
  scope: PreparationScope,
  requestId: string,
  expected: (task: ChatImportTask) => ImportPreparation,
): ChatImportTask {
  const task = parseSavedImportTask(value, scope.companyId, requestId)
  if (
    task.decision.status !== "approved" ||
    task.decision.selectedOptionId !== "prepare_import" ||
    importPreparationIdentity(task.preparation) !==
      importPreparationIdentity(expected(task))
  ) {
    throw new Error(
      "The saved preparation does not match these approved source rules. Retry the same choices to finish the request.",
    )
  }
  return task
}

export async function listImportRecipes(
  fetcher: ImportTaskFetch,
  scope: PreparationScope,
): Promise<ImportRecipe[]> {
  const body = z
    .object({ recipes: z.array(importRecipeSchema).max(100) })
    .parse(await request(fetcher, `/api/import-recipes?${scopeQuery(scope)}`))
  if (
    body.recipes.some((recipe) => recipe.companyId !== String(scope.companyId))
  )
    throw new Error("A preparation recipe belongs to another company.")
  return body.recipes
}

export async function reprepareImportTask(
  fetcher: ImportTaskFetch,
  scope: PreparationScope,
  preparation: ImportPreparation,
): Promise<ChatImportTask> {
  const rules = importPreparationSchema.parse(preparation)
  const requestId = await requestKey(
    "reprepare/v1",
    scope,
    importPreparationIdentity(rules),
  )
  return postWithReceipt(
    fetcher,
    `/api/import-tasks/${scope.taskId}/reprepare`,
    { companyId: scope.companyId, requestId, preparation: rules },
    `/api/import-tasks/${requestId}?${scopeQuery(scope)}`,
    (value) => preparedTask(value, scope, requestId, () => rules),
  )
}

export async function saveImportRecipe(
  fetcher: ImportTaskFetch,
  scope: PreparationScope,
  recipe: { key: string; name: string; expectedVersion: number },
): Promise<ImportRecipe> {
  if (
    !/^[a-z][a-z0-9_-]{0,99}$/.test(recipe.key) ||
    !recipe.name.trim() ||
    new TextEncoder().encode(recipe.name.trim()).length > 200 ||
    /[\u0000-\u001f]/.test(recipe.name) ||
    !Number.isSafeInteger(recipe.expectedVersion) ||
    recipe.expectedVersion < 0 ||
    recipe.expectedVersion >= 2_147_483_647
  ) {
    throw new Error("Choose a recipe name and its current version.")
  }
  const payload = {
    key: recipe.key,
    name: recipe.name.trim(),
    expectedVersion: recipe.expectedVersion,
  }
  const requestId = await requestKey("save-recipe/v1", scope, payload)
  return postWithReceipt(
    fetcher,
    "/api/import-recipes",
    {
      companyId: scope.companyId,
      sourceRequestId: scope.taskId,
      requestId,
      ...payload,
    },
    `/api/import-recipes/requests/${requestId}?${scopeQuery(scope)}`,
    (value) => {
      const saved = importRecipeSchema.parse(value)
      if (
        saved.companyId !== String(scope.companyId) ||
        saved.key !== recipe.key ||
        saved.name !== payload.name ||
        saved.version !== recipe.expectedVersion + 1
      ) {
        throw new Error(
          "The saved recipe does not match the requested version.",
        )
      }
      return saved
    },
  )
}

export async function applyImportRecipe(
  fetcher: ImportTaskFetch,
  scope: PreparationScope,
  recipe: ImportRecipe,
  bindings: { slotKey: string; ordinal: number }[],
): Promise<ChatImportTask> {
  const current = importRecipeSchema.parse(recipe)
  if (
    current.companyId !== String(scope.companyId) ||
    bindings.length !== current.slots.length ||
    new Set(bindings.map((binding) => binding.slotKey)).size !==
      current.slots.length ||
    new Set(bindings.map((binding) => binding.ordinal)).size !==
      bindings.length ||
    bindings.some(
      (binding) =>
        !current.slots.some((slot) => slot.key === binding.slotKey) ||
        !Number.isSafeInteger(binding.ordinal) ||
        binding.ordinal < 0 ||
        binding.ordinal > 19,
    )
  ) {
    throw new Error(
      "Match each recipe source to a different saved file in this company.",
    )
  }
  const payload = {
    version: current.version,
    bindings: [...bindings].sort((left, right) =>
      left.slotKey < right.slotKey ? -1 : left.slotKey > right.slotKey ? 1 : 0,
    ),
  }
  const requestId = await requestKey("apply-recipe/v1", scope, {
    key: current.key,
    ...payload,
  })
  return postWithReceipt(
    fetcher,
    `/api/import-recipes/${current.key}/apply`,
    {
      companyId: scope.companyId,
      requestId,
      sourceRequestId: scope.taskId,
      ...payload,
    },
    `/api/import-tasks/${requestId}?${scopeQuery(scope)}`,
    (value) =>
      preparedTask(value, scope, requestId, (task) => {
        if (task.files.length !== current.slots.length)
          throw new Error(
            "The prepared recipe does not contain its selected source files.",
          )
        return {
          version: 1,
          recipe: { key: current.key, version: current.version },
          files: current.slots.map((slot, index) => ({
            ...slot.options,
            fileName: task.files[index]!.fileName,
            sourceSha256: task.files[index]!.sha256,
          })),
        }
      }),
  )
}
