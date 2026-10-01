/** Wire IDs stay decimal strings: a JS number cannot represent the full u64 range. */
export function u64(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]{0,19})$/.test(value) ||
    BigInt(value) > 18446744073709551615n
  ) {
    throw new Error("Expected a canonical u64 decimal string");
  }
  return value;
}

export function u32(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 4294967295
  ) {
    throw new Error("Expected u32");
  }
  return value;
}

export function stringValue(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096)
    throw new Error("Expected bounded string");
  return value;
}

export function objectValue<K extends string>(
  value: unknown,
  fields: readonly K[],
): Record<K, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected object");
  const keys = Object.keys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key as K))
  ) {
    throw new Error("Unexpected or missing projection fields");
  }
  return value as Record<K, unknown>;
}
