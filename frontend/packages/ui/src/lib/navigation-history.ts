const KEY = "__lumiere_navigation_guard"

interface Position { token: string; index: number }

function navigationToken(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) =>
    value.toString(16).padStart(8, "0"),
  ).join("")
}

function position(state: unknown): Position | undefined {
  if (typeof state !== "object" || state === null || !(KEY in state)) return
  const value = (state as { [KEY]: unknown })[KEY]
  if (typeof value !== "object" || value === null) return
  const candidate = value as Position
  if (typeof candidate.token === "string" && Number.isSafeInteger(candidate.index)) return candidate
}

/** Track same-document entries without replacing Next.js's router state.
 * A guarded pop is restored before asking; accept then replays the original delta.
 * Full document exits remain covered by beforeunload.
 */
export function installNavigationHistoryGuard(
  shouldGuard: () => boolean,
  confirm: () => Promise<boolean>,
): () => void {
  const token = navigationToken()
  const originalPush = history.pushState
  const originalReplace = history.replaceState
  let current = 0
  let replay: number | undefined
  let restore: { target: number; resolve: () => void } | undefined
  let deciding = false
  let disposed = false
  const stamp = (state: unknown, index: number) => ({
    ...(typeof state === "object" && state !== null ? state : {}),
    [KEY]: { token, index },
  })
  const push: History["pushState"] = function (this: History, state, unused, url) {
    if (disposed) { originalPush.call(this, state, unused, url); return }
    const next = current + 1
    originalPush.call(this, stamp(state, next), unused, url)
    current = next
  }
  const replace: History["replaceState"] = function (this: History, state, unused, url) {
    if (disposed) { originalReplace.call(this, state, unused, url); return }
    originalReplace.call(this, stamp(state, current), unused, url)
  }
  originalReplace.call(history, stamp(history.state, current), "")
  history.pushState = push
  history.replaceState = replace

  const onPop = (event: PopStateEvent) => {
    const next = position(event.state)
    if (!next || next.token !== token) return
    if (restore) {
      event.stopImmediatePropagation()
      if (next.index === restore.target) {
        const resolve = restore.resolve
        restore = undefined
        resolve()
      } else {
        history.go(restore.target - next.index)
      }
      return
    }
    if (replay === next.index) {
      replay = undefined
      current = next.index
      return
    }
    const delta = next.index - current
    if (delta === 0) return
    if (!shouldGuard() && !deciding) {
      current = next.index
      return
    }
    event.stopImmediatePropagation()
    // Restore first so the address bar and the rendered editor stay consistent.
    const restored = new Promise<void>((resolve) => {
      restore = { target: current, resolve }
      history.go(-delta)
    })
    if (deciding) return
    deciding = true
    void restored.then(async () => {
      const accepted = await confirm()
      deciding = false
      if (disposed || !accepted) return
      replay = current + delta
      history.go(delta)
    })
  }
  // Layout-effect installation precedes the App Router's passive popstate listener.
  window.addEventListener("popstate", onPop)
  return () => {
    disposed = true
    restore?.resolve()
    restore = undefined
    window.removeEventListener("popstate", onPop)
    if (history.pushState === push) history.pushState = originalPush
    if (history.replaceState === replace) history.replaceState = originalReplace
  }
}
