import type { LumiereHttpFetch } from "@lumiere/api-client"
import {
  createGeneratedStdbSdk,
  type GeneratedStdbSdk,
  type SdkOperationInput,
  type SdkOperationName,
} from "@lumiere/contracts/generated/sdk"

import { stdbBffCommandPost } from "./commands"
import { stdbParamsToJson } from "./stdb-params-json"

export type StdbSdk = GeneratedStdbSdk

const PARAM_STRUCT_BY_OPERATION = {
  create_account_account: "CreateAccountAccountParams",
  create_whatsapp_business_account: "CreateWhatsAppBusinessAccountParams",
  update_whatsapp_business_account: "UpdateWhatsAppBusinessAccountParams",
} as const satisfies Partial<Record<SdkOperationName, string>>

function encodeOperationInput<K extends SdkOperationName>(
  operation: K,
  input: SdkOperationInput<K>,
): SdkOperationInput<K> {
  let encoded = input as Record<string, unknown>
  if (
    operation === "create_google_drive_connection" ||
    operation === "update_google_drive_connection"
  ) {
    encoded = { ...encoded }
    if (typeof encoded.syncDirection === "string") {
      encoded.syncDirection = { tag: encoded.syncDirection }
    }
    if (typeof encoded.conflictPolicy === "string") {
      encoded.conflictPolicy = { tag: encoded.conflictPolicy }
    }
  }

  const structName = PARAM_STRUCT_BY_OPERATION[
    operation as keyof typeof PARAM_STRUCT_BY_OPERATION
  ]
  if (!structName) return encoded as SdkOperationInput<K>

  const params = encoded.params
  if (params === null || typeof params !== "object") {
    return encoded as SdkOperationInput<K>
  }
  return {
    ...encoded,
    params: stdbParamsToJson(params, structName),
  } as SdkOperationInput<K>
}

async function executeOperation<K extends SdkOperationName>(
  apiFetch: LumiereHttpFetch,
  operation: K,
  input: SdkOperationInput<K>,
): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost(
    operation,
    encodeOperationInput(operation, input),
  )
  const response = await apiFetch(urlPath, init)
  if (response.ok) return

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string
    message?: string
  }
  throw new Error(payload.message ?? payload.error ?? `Operation ${operation} failed`)
}

/** Bind the contracts-owned domain SDK to Lumiere's authenticated HTTP transport. */
export function createStdbSdk(apiFetch: LumiereHttpFetch): StdbSdk {
  return createGeneratedStdbSdk((operation, input) =>
    executeOperation(apiFetch, operation, input),
  )
}
