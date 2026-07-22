/** Browser-only storage primitives shared by local outboxes. */
export function getOrCreateLocalStorageDeviceId(key: string): string {
  if (typeof window === "undefined") return "server"

  let id = window.localStorage.getItem(key)
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now()}`
    window.localStorage.setItem(key, id)
  }
  return id
}

export function readLocalStorageArray<T>(key: string): T[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as T[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writeLocalStorageArray<T>(key: string, items: T[]): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(key, JSON.stringify(items))
}
