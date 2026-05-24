/** Loose row shape from `/api/query/iot-devices` (and similar IoT lists). */
export type IotQueryRow = Record<string, unknown>;

/** Primary label for IoT device rows. */
export function iotDevicePrimaryLabel(row: IotQueryRow): string {
  const candidates = [row.name, row.identifier, row.serial];
  for (const c of candidates) {
    if (typeof c === "string") {
      const t = c.trim();
      if (t.length > 0) return t;
    }
  }
  const id = row.id;
  if (typeof id === "number" || typeof id === "bigint") return `#${id}`;
  if (typeof id === "string" && id.trim() !== "") return `#${id.trim()}`;
  return "";
}
