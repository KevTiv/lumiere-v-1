"use client"

import { createElement, Fragment, useLayoutEffect, type ReactNode } from "react"

import type { LumiereApiClient } from "./create-client"

let registered: LumiereApiClient | null = null

export function registerLumiereApiClient(client: LumiereApiClient | null): void {
  registered = client
}

export function getLumiereApiClient(): LumiereApiClient | null {
  return registered
}

export function getLumiereApiClientOrThrow(): LumiereApiClient {
  if (!registered) {
    throw new Error(
      "LumiereApiClient not registered — wrap the tree with <LumiereApiProvider client={...}> (web: webApi; Expo: mobileApi).",
    )
  }
  return registered
}

export function LumiereApiProvider({
  client,
  children,
}: {
  client: LumiereApiClient
  children: ReactNode
}) {
  // Synchronous registration so first paint of children can call apiFetch / mutations.
  registerLumiereApiClient(client)
  // Re-sync when `client` identity changes (e.g. hot reload). No cleanup: Strict Mode would
  // briefly clear the singleton and break in-flight / immediate post-mount mutations.
  useLayoutEffect(() => {
    registerLumiereApiClient(client)
  }, [client])
  return createElement(Fragment, null, children)
}
