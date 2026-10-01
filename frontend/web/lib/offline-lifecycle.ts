/** No business data or credentials: this marker only revokes an open reader. */
export const OFFLINE_REVOCATION_KEY = "lumiere:offline-revocation";
const CHANNEL = "lumiere:offline-lifecycle";
export const ACTIVE_COMPANY_KEY = "lumiere:active-company";

export function revokeOfflineReaders(): void {
  const token =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  try {
    localStorage.setItem(OFFLINE_REVOCATION_KEY, token);
  } catch {
    /* Broadcast still works. */
  }
  window.dispatchEvent(new Event(CHANNEL));
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage(token);
      channel.close();
    } catch {
      /* Storage events still revoke readers in restricted browsers. */
    }
  }
}

/** Invalidates synchronously; the owner then clears its scoped rows and checkpoint. */
export function watchOfflineRevocation(revoke: () => void): () => void {
  const channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(CHANNEL);
  if (channel) channel.onmessage = revoke;
  const storage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === OFFLINE_REVOCATION_KEY ||
      event.key === ACTIVE_COMPANY_KEY
    )
      revoke();
  };
  window.addEventListener("storage", storage);
  window.addEventListener(CHANNEL, revoke);
  return () => {
    channel?.close();
    window.removeEventListener("storage", storage);
    window.removeEventListener(CHANNEL, revoke);
  };
}
