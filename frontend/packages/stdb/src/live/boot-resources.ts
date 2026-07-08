import { SESSION_WORKSPACE_RESOURCE_KEYS } from "../subscriptions/session-workspace"

/** Subscribed once on WebSocket connect (session + RBAC). */
export const BOOT_SUBSCRIPTION_RESOURCES: readonly string[] = [
  ...SESSION_WORKSPACE_RESOURCE_KEYS,
  "roles",
]

/** Mutable copy for {@link StdbConnectionProvider} (stable reference — avoids reconnect loops). */
export const BOOT_SUBSCRIPTION_RESOURCE_LIST: string[] = [...BOOT_SUBSCRIPTION_RESOURCES]
