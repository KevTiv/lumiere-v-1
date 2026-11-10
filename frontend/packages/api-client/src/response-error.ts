/**
 * A non-successful HTTP response whose status must survive across query layers.
 *
 * Consumers classify authorization and transient server failures from `status`;
 * keeping it on a shared error avoids parsing messages or recreating transport
 * rules in individual hooks.
 */
export class HttpResponseError extends Error {
  readonly status: number

  constructor(
    status: number,
    message: string,
    readonly code?: string,
    readonly recoveryPath?: string,
  ) {
    super(message)
    this.name = "HttpResponseError"
    this.status = status
  }
}

/**
 * Returns the most useful error message from an unsuccessful HTTP response.
 *
 * The response body is read once, so callers can safely use this as their only
 * error-body consumer.
 */
export async function responseErrorMessage(response: Response, fallback?: string): Promise<string> {
  const payload = await readErrorPayload(response)
  return errorMessage(response, payload, fallback)
}

/** Build a typed error while consuming an unsuccessful response body once. */
export async function httpResponseError(
  response: Response,
  fallback?: string,
): Promise<HttpResponseError> {
  const payload = await readErrorPayload(response)
  return new HttpResponseError(
    response.status,
    errorMessage(response, payload, fallback),
    typeof payload.code === "string" ? payload.code : undefined,
    typeof payload.recovery_path === "string" ? payload.recovery_path : undefined,
  )
}

async function readErrorPayload(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => null)
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {}
}

function errorMessage(
  response: Response,
  payload: Record<string, unknown>,
  fallback?: string,
): string {
  return (
    [payload.error, payload.detail, payload.message, fallback, response.statusText].find(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    ) ?? `Request failed (${response.status})`
  )
}
