/** Keep only keys explicitly set on a partial patch (value !== undefined). */
export function pickDefined<T extends object>(partial: Partial<T>): T {
  const out = {} as T;
  for (const key of Object.keys(partial) as (keyof T)[]) {
    const value = partial[key];
    if (value !== undefined) {
      out[key] = value as T[keyof T];
    }
  }
  return out;
}
