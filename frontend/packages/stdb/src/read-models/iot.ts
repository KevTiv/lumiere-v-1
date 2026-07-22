/** Loose row shape from `/api/query/iot-devices` (and similar IoT lists). */
export type IotQueryRow = Record<string, unknown>;

/** Primary label for IoT device rows. */
export function iotDevicePrimaryLabel(row: IotQueryRow): string {
  return primaryLabel([row.name, row.identifier, row.serial], row.id);
}
import { primaryLabel } from "./primary-label";
