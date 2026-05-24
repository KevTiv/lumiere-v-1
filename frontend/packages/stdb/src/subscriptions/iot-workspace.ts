import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * IoT list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const IOT_WORKSPACE_RESOURCE_KEYS = [
  "iot-actions",
  "iot-alerts",
  "iot-devices",
  "iot-hubs",
  "iot-pairing-tokens",
  "iot-telemetry",
  "iot-thresholds",
] as const;

export type IotWorkspaceResourceKey = (typeof IOT_WORKSPACE_RESOURCE_KEYS)[number];

export type IotWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
