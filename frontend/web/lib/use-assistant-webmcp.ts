"use client"

import { useLayoutEffect, useRef } from "react"
import type { DispatchPresentationDestination } from "./assistant-presentation-dispatcher"
import { registerAssistantWebMcpTools, type WebMcpModelContext, type WebMcpPresentationAvailability } from "./assistant-webmcp"

export function useAssistantWebMcp({
  scopeKey,
  routeKey,
  canOpenInventoryRecord,
  canOpenImportReview,
  dispatch,
}: WebMcpPresentationAvailability & {
  scopeKey: string | null
  routeKey: string
  dispatch: DispatchPresentationDestination
}) {
  const dispatchRef = useRef(dispatch)
  useLayoutEffect(() => {
    dispatchRef.current = dispatch
  }, [dispatch])
  useLayoutEffect(() => {
    if (!scopeKey || window.top !== window) return

    const { modelContext } = document as Document & { modelContext?: WebMcpModelContext }
    return registerAssistantWebMcpTools(
      modelContext,
      { canOpenInventoryRecord, canOpenImportReview },
      (destination, options) => dispatchRef.current(destination, options),
    )
  }, [scopeKey, routeKey, canOpenInventoryRecord, canOpenImportReview])
}
