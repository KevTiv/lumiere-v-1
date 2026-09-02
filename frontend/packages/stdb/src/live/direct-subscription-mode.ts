/**
 * Direct SDK subscriptions materialize complete table rows in the browser.
 * Keep them explicitly opt-in while the web application uses the API-server
 * invalidation socket plus authorized HTTP reads.
 */
export type DirectSubscriptionMode = "disabled" | "legacy-row-cache"

export function directRowCacheEnabled(input: {
  mode?: DirectSubscriptionMode
  token?: string
  organizationId?: number
}): boolean {
  return (
    input.mode === "legacy-row-cache"
    && Boolean(input.token)
    && input.organizationId != null
    && input.organizationId > 0
  )
}
