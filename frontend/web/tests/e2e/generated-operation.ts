import type { Page } from "@playwright/test"
import { stdbBffCommandPost, type StdbBffCommandInput } from "@lumiere/stdb/commands"
import type { StdbBffNamedReducerKey } from "@lumiere/stdb/commands"

export type OperationResult = { ok: boolean; status: number; error?: string }

/**
 * Authenticated generated-operation call (`/api/operations/<contract id>`) with the exact named
 * input the UI sends. Unlike the fixture-only compatibility route, the organization comes from
 * the session and the contract's own validation applies.
 */
export async function postGeneratedOperation<K extends StdbBffNamedReducerKey>(
  page: Page,
  reducer: K,
  input: StdbBffCommandInput<K>,
): Promise<OperationResult> {
  const command = stdbBffCommandPost(reducer, input)
  const res = await page.request.post(command.urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(command.init.body)),
  })
  if (res.ok()) return { ok: true, status: res.status() }
  const json = (await res.json().catch(() => ({}))) as { error?: string }
  const error = json.error ?? (await res.text().catch(() => ""))
  return { ok: false, status: res.status(), error: error || undefined }
}

export async function postGeneratedOperationOk<K extends StdbBffNamedReducerKey>(
  page: Page,
  reducer: K,
  input: StdbBffCommandInput<K>,
): Promise<void> {
  const result = await postGeneratedOperation(page, reducer, input)
  if (!result.ok) {
    throw new Error(`generated operation ${reducer} failed (${result.status}): ${result.error ?? ""}`)
  }
}
