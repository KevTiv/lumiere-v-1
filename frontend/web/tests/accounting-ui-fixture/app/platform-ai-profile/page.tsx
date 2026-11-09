"use client"

import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider } from "@lumiere/i18n"
import { createLumiereApiClient, LumiereApiProvider } from "@lumiere/api-client"
import { PlatformAiProfilePanel } from "../../../../app/(modules)/ai-harness/platform-ai-profile-panel"

const api = createLumiereApiClient({ baseUrl: "" })
export default function Page() {
  const [client] = useState(() => new QueryClient())
  return <LumiereApiProvider client={api}><QueryClientProvider client={client}><I18nProvider language="en">
    <main className="p-6"><PlatformAiProfilePanel organizationId={11n} /></main>
  </I18nProvider></QueryClientProvider></LumiereApiProvider>
}
