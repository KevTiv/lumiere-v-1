/** Browser preferences are best effort: blocked storage must not block the UI. */
export function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // The in-memory preference still applies when persistence is unavailable.
  }
}
