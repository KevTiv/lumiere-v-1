/**
 * A non-successful HTTP response whose status must survive across query layers.
 *
 * Consumers classify authorization and transient server failures from `status`;
 * keeping it on a shared error avoids parsing messages or recreating transport
 * rules in individual hooks.
 */
export class HttpResponseError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
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
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>

  return (
    [payload.error, payload.detail, payload.message, fallback, response.statusText].find(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    ) ??
    `Request failed (${response.status})`
  )
}

/** Build a typed error while consuming an unsuccessful response body once. */
export async function httpResponseError(
  response: Response,
  fallback?: string,
): Promise<HttpResponseError> {
  return new HttpResponseError(
    response.status,
    await responseErrorMessage(response, fallback),
  )
}
