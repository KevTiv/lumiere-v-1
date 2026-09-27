import type { JsonObject } from "./json-object"

export type OperationRetryDisposition =
  | "never"
  | "refresh"
  | "reconcile"
  | "later"

export type OperationProblemCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_input"
  | "conflict"
  | "gone"
  | "not_found"
  | "rate_limited"
  | "dependency_unavailable"
  | "internal"
  | "protocol_error"

/**
 * Transport-level acknowledgement only.
 *
 * `accepted` means the HTTP operation returned successfully. It deliberately
 * does not mean the business effect was newly applied. A workflow must resolve
 * canonical state before claiming Applied/AlreadyApplied to the user.
 */
export interface OperationDispatchReceipt {
  readonly kind: "accepted"
  readonly operationId?: string
  readonly correlationId?: string
}

export class OperationRequestError extends Error {
  readonly code: OperationProblemCode
  readonly status: number
  readonly retry: OperationRetryDisposition
  readonly correlationId?: string

  constructor(args: {
    code: OperationProblemCode
    status: number
    message: string
    retry: OperationRetryDisposition
    correlationId?: string
  }) {
    super(args.message)
    this.name = "OperationRequestError"
    this.code = args.code
    this.status = args.status
    this.retry = args.retry
    this.correlationId = args.correlationId
  }
}

function stringField(payload: JsonObject, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "string" && value.trim() !== "") return value
  }
  return undefined
}

function classifyStatus(status: number): {
  code: OperationProblemCode
  retry: OperationRetryDisposition
} {
  switch (status) {
    case 401:
      return { code: "unauthorized", retry: "never" }
    case 403:
      return { code: "forbidden", retry: "never" }
    case 400:
    case 422:
      return { code: "invalid_input", retry: "never" }
    case 404:
      return { code: "not_found", retry: "refresh" }
    case 409:
      return { code: "conflict", retry: "refresh" }
    case 410:
      return { code: "gone", retry: "never" }
    case 429:
      return { code: "rate_limited", retry: "later" }
    case 503:
      return { code: "dependency_unavailable", retry: "reconcile" }
    default:
      if (status >= 500) return { code: "internal", retry: "reconcile" }
      return { code: "protocol_error", retry: "never" }
  }
}

async function readPayload(response: Response): Promise<JsonObject> {
  const payload = await response.json().catch(() => ({}))
  return payload != null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as JsonObject)
    : {}
}

/**
 * Decode the current operation transport without upgrading transport success to
 * business success. This accepts today's `{ ok: true }` response and is forward
 * compatible with operation/correlation identifiers added by the server.
 */
export async function decodeOperationDispatch(
  response: Response,
  fallbackMessage = "Operation failed",
): Promise<OperationDispatchReceipt> {
  const payload = await readPayload(response)
  const correlationId = stringField(payload, "correlationId", "correlation_id")

  if (!response.ok) {
    const classified = classifyStatus(response.status)
    throw new OperationRequestError({
      ...classified,
      status: response.status,
      message:
        stringField(payload, "error", "detail", "message") ?? fallbackMessage,
      correlationId,
    })
  }

  if (payload.ok !== true) {
    throw new OperationRequestError({
      code: "protocol_error",
      status: response.status,
      retry: "reconcile",
      message: "Operation response did not contain the expected acknowledgement",
      correlationId,
    })
  }

  const operationId = stringField(payload, "operationId", "operation_id")
  return {
    kind: "accepted",
    ...(operationId === undefined ? {} : { operationId }),
    ...(correlationId === undefined ? {} : { correlationId }),
  }
}
