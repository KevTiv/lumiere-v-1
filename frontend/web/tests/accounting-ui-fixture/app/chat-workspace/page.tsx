"use client"

import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider } from "@lumiere/i18n"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { AIChatPanel } from "../../../../../packages/ui/src/ai-chat/ai-chat-panel"
import { DashboardWorkspace } from "../../../../../packages/ui/src/pages/dashboard-workspace"
import { DashboardSidebar } from "../../../../../packages/ui/src/pages/dashboard-sidebar"
import { ThemeProvider } from "@lumiere/ui/components/theme-provider"
import { RBACProvider } from "@lumiere/ui/lib/rbac-context"
import { Button } from "@lumiere/ui/components/button"
import { Input } from "@lumiere/ui/components/input"
import { TooltipProvider } from "@lumiere/ui/components/tooltip"
import { Sparkles } from "lucide-react"
import { WorkspaceProfileProvider } from "@lumiere/ui/lib/workspace-profile-context"

// Production layout and chat, with a local draft and simulated answers only.
function Workspace() {
  const [open, setOpen] = useState(false)
  const [docked, setDocked] = useState(true)
  const [context, setContext] = useState("current")
  return <DashboardWorkspace forceCollapsed={open && docked} onOpenSearch={() => undefined}
    sidebar={<DashboardSidebar forceCollapsed={open && docked} aiChatOpen={open} onOpenAIChat={() => { setDocked(true); setOpen(true) }} />}
    overlays={<AIChatPanel open={open} docked={docked} onClose={() => setOpen(false)} onDockToggle={() => setDocked(value => !value)}
      contextOptions={[{ value: "current", label: "Current page", group: "Context" }, { value: "module:inventory", label: "Inventory", group: "Modules" }]}
      selectedContext={context} onContextChange={setContext}
      context={{ module: "accounting", activeView: "Accounting", companyId: 7 }}
      config={{ title: "Lumière Assistant", guideLibraryHref: "/documents/knowledge", welcomeMessage: "Explore your business, prepare a draft, or turn an insight into a report.", skills: [
        { id: "reconcile", label: "Reconcile accounts", description: "Compare bank activity with ledger entries.", icon: "check-square", keywords: ["bank", "match"], prompt: "Review reconciliation differences and prepare suggestions for review." },
      ] }}
      onSendMessage={async (text) => ({ content: "Review the customer, invoice date, and line items before posting.\n\nThe invoice stays a draft until you confirm the action." + (text.includes("overflow") ? "\n\n" + "long-record-reference-".repeat(45) : "") })}
    />}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-muted-foreground">Accounting / Invoices</p><h1 className="mt-2 text-2xl font-semibold">New invoice</h1></div><Button onClick={() => { setDocked(true); setOpen(true) }}><Sparkles className="size-4" />Ask Lumière</Button></div>
      <div className="space-y-5 rounded-xl border bg-card p-6">
        <h2 className="font-semibold">Invoice details</h2>
        <div className="grid gap-5 xl:grid-cols-2"><label className="space-y-2 text-sm">Customer<Input aria-label="Customer" placeholder="Choose a customer" /></label><label className="space-y-2 text-sm">Reference<Input aria-label="Invoice reference" placeholder="Your reference" /></label></div>
        <p className="text-sm text-muted-foreground">Layout fixture. No business records are created.</p>
      </div>
    </div>
  </DashboardWorkspace>
}

export default function Page() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}>
    <I18nProvider language="en">
      <RBACProvider useDefaultFixtures>
        <ErpSessionProvider value={{ identity: null, connected: false }}>
          <ThemeProvider defaultTheme="dark">
            <TooltipProvider>
              <WorkspaceProfileProvider value="finance-alpha"><Workspace /></WorkspaceProfileProvider>
            </TooltipProvider>
          </ThemeProvider>
        </ErpSessionProvider>
      </RBACProvider>
    </I18nProvider>
  </QueryClientProvider>
}
