import { optionalBigIntU64, unwrapSome } from '@lumiere/erp-shared/form-coercion';

/**
 * Wire helpers for the tax group, jurisdiction and schedule reducers. Their hooks encode the body
 * without a struct name, so every `Option` field is spelled out here as SATS `{some}` / `{none: []}`
 * (an `Option<Option<T>>` is a `some` around either).
 */

export type Row = Record<string, unknown>;
export type Opt<T> = { some: T } | { none: [] };

export const NONE: { none: [] } = { none: [] };

/** A row cell as trimmed text; '' when empty or absent (handles `{some}` wrapped options). */
export function cellText(value: unknown): string {
  const unwrapped = unwrapSome(value);
  return unwrapped == null ? '' : String(unwrapped).trim();
}

/** A row id cell as a positive id, else null. */
export function cellId(value: unknown): bigint | null {
  const id = optionalBigIntU64(unwrapSome(value));
  return id != null && id > 0n ? id : null;
}

/** `Option<String>`: blank is `none`. */
export function optText(raw: unknown): Opt<string> {
  const text = cellText(raw);
  return text === '' ? NONE : { some: text };
}

/** `Option<u64>`: a missing or non-positive id is `none`. */
export function optId(raw: unknown): Opt<bigint> {
  const id = cellId(raw);
  return id == null ? NONE : { some: id };
}

/** `Option<Option<T>>` for an update: `some` of the (possibly `none`) new value means "change". */
export function change<T>(next: Opt<T>): { some: Opt<T> } {
  return { some: next };
}

/** `Option<T>` for an update field: `some` when it is set, else `none` (leave unchanged). */
export function set<T>(value: T): { some: T } {
  return { some: value };
}

/** A leading "none" choice so an optional select can be left empty (or cleared on edit). */
export function withNone(
  options: readonly { value: string; label: string }[],
  noneLabel: string,
): { value: string; label: string }[] {
  return [{ value: '', label: noneLabel }, ...options];
}
