/**
 * Returns the most useful error message from an unsuccessful HTTP response.
 *
 * The response body is read once, so callers can safely use this as their only
 * error-body consumer.
 */
export async function responseErrorMessage(response: Response, fallback?: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>

  return (
    [payload.error, payload.detail, fallback, response.statusText].find(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    ) ??
    `Request failed (${response.status})`
  )
}
