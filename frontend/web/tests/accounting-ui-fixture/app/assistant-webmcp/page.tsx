"use client"

import { useState } from "react"
import type { PresentationDestination } from "../../../../lib/assistant-presentation-dispatcher"
import { useAssistantWebMcp } from "../../../../lib/use-assistant-webmcp"

export default function AssistantWebMcpFixture() {
  const [companyId, setCompanyId] = useState("4097")
  const [route, setRoute] = useState("/inventory")
  const [signedIn, setSignedIn] = useState(true)
  const [pause, setPause] = useState(false)
  const [pending, setPending] = useState(false)
  const [destination, setDestination] = useState<PresentationDestination | null>(null)

  useAssistantWebMcp({
    scopeKey: signedIn && companyId === "4097" ? companyId : null,
    routeKey: route,
    canOpenInventoryRecord: true,
    canOpenImportReview: true,
    async dispatch(destination, options) {
      if (pause) {
        const signal = options?.signal
        if (!signal || signal.aborted) return "cancelled"
        setPending(true)
        await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }))
        setPending(false)
        return "cancelled"
      }
      setDestination(destination)
      return "opened"
    },
  })

  return (
    <main>
      <h1>Assistant WebMCP fixture</h1>
      <button onClick={() => setRoute("/settings")}>Change route</button>
      <button onClick={() => setCompanyId("4098")}>Switch company</button>
      <button onClick={() => setCompanyId("4097")}>Return to pilot company</button>
      <button onClick={() => setSignedIn(false)}>Sign out</button>
      <button onClick={() => setPause(true)}>Pause next navigation</button>
      <output data-testid="route">{route}</output>
      <output data-testid="pending">{pending ? "pending" : "idle"}</output>
      <output data-testid="destination">{destination && JSON.stringify(destination)}</output>
    </main>
  )
}
