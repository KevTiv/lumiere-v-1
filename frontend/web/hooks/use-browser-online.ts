"use client"

import { useSyncExternalStore } from "react"

function subscribe(update: () => void) {
  window.addEventListener("online", update)
  window.addEventListener("offline", update)
  return () => {
    window.removeEventListener("online", update)
    window.removeEventListener("offline", update)
  }
}

export function useBrowserOnline() {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}
