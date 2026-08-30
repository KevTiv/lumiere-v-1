import type { ReducerCommandContractMeta } from "./types";

/**
 * IoT mutations via the api-server BFF `POST /api/operations/:operation`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` IoT hooks.
 */
export const IOT_BFF_REDUCERS = [
  "acknowledge_iot_action",
  "claim_hub_with_token",
  "create_iot_action",
  "create_iot_alert",
  "delete_iot_device",
  "delete_iot_hub",
  "fail_iot_action",
  "generate_hub_pairing_token",
  "link_device_to_location",
  "link_device_to_pos",
  "mark_action_sent",
  "record_telemetry",
  "record_telemetry_batch",
  "register_iot_device",
  "register_iot_hub",
  "resolve_iot_alert",
  "retry_iot_action",
  "set_iot_threshold",
  "sync_hub_devices",
  "test_iot_device",
  "unlink_device",
  "update_device_status",
  "update_hub_heartbeat",
] as const;

export type IotBffReducerKey = (typeof IOT_BFF_REDUCERS)[number];

const IOT_MODULE_RESOURCES = [
  "iot-devices",
  "iot-hubs",
  "iot-pairing-tokens",
  "iot-alerts",
  "iot-actions",
  "iot-telemetry",
  "iot-thresholds",
] as const;

function iotReducerHints(): Record<IotBffReducerKey, readonly string[]> {
  const o = {} as Record<IotBffReducerKey, readonly string[]>;
  for (const k of IOT_BFF_REDUCERS) {
    o[k] = IOT_MODULE_RESOURCES;
  }
  return o;
}

export const IOT_COMMAND_SUBSCRIPTION_HINTS: Record<
  IotBffReducerKey,
  readonly string[]
> = iotReducerHints();

export function iotCommandContract(
  reducer: IotBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `IoT reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: IOT_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
