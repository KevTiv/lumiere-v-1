/** Module-level subscription readiness (for non-React invalidation helpers). */
let subscriptionReady = false

export function setSubscriptionReady(ready: boolean): void {
  subscriptionReady = ready
}

export function isSubscriptionReady(): boolean {
  return subscriptionReady
}
