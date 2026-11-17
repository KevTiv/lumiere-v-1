"use client"

import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider } from "@lumiere/i18n"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { AIChatPanel } from "../../../../../packages/ui/src/ai-chat/ai-chat-panel"
import { ChatHistoryPanel } from "../../../../../packages/ui/src/ai-chat/chat-history-panel"
import { DashboardWorkspace } from "../../../../../packages/ui/src/pages/dashboard-workspace"
import { DashboardSidebar } from "../../../../../packages/ui/src/pages/dashboard-sidebar"
import { NotebookPanel } from "../../../../../packages/ui/src/notebook/notebook-panel"
import { ThemeProvider } from "@lumiere/ui/components/theme-provider"
import { RBACProvider } from "@lumiere/ui/lib/rbac-context"
import { Button } from "@lumiere/ui/components/button"
import { Input } from "@lumiere/ui/components/input"
import { TooltipProvider } from "@lumiere/ui/components/tooltip"
import { Sparkles } from "lucide-react"
import { WorkspaceProfileProvider } from "@lumiere/ui/lib/workspace-profile-context"

const conversations = [
  { key: "import", title: "Products catalog import", moduleLabel: "Products", timestamp: "Today", archived: false },
  { key: "warehouse", title: "Warehouse stock review", moduleLabel: "Warehouse", timestamp: "Yesterday", archived: true },
]
const historyModules = [
  { value: "Products", label: "Products" },
  { value: "Warehouse", label: "Warehouse" },
]

// Production layout and chat, with a local draft and simulated answers only.
function Workspace() {
  const [tool, setTool] = useState<"assistant" | "notebook" | null>(null)
  const [docked, setDocked] = useState(true)
  const [notebookDocked, setNotebookDocked] = useState(true)
  const [context, setContext] = useState("current")
  const [historyOpen, setHistoryOpen] = useState(false)
  const [archived, setArchived] = useState(false)
  const [search, setSearch] = useState("")
  const [module, setModule] = useState("")
  const [thread, setThread] = useState("import")
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [threads, setThreads] = useState(conversations)
  const selected = threads.find(entry => entry.key === thread)
  const historyEntries = threads.filter(entry => entry.archived === archived &&
    (!module || entry.moduleLabel === module) &&
    entry.title.toLowerCase().includes(search.toLowerCase()))
  const openAssistant = () => { setDocked(true); setTool("assistant") }
  const dockRequest = tool === "assistant" ? docked ? tool : null : notebookDocked ? tool : null
  return <DashboardWorkspace dockRequest={dockRequest} onOpenSearch={() => undefined}
    sidebar={(collapsed) => <DashboardSidebar forceCollapsed={collapsed} aiChatOpen={tool === "assistant"} onOpenAIChat={openAssistant} />}
    overlays={({ container, docked: placement, canDock }) => <>
      <AIChatPanel open={tool === "assistant"} workspaceHost={container} docked={placement === "assistant"}
      onClose={() => setTool(null)} onDockToggle={canDock("assistant") ? () => setDocked(value => !value) : undefined}
      conversationKey={thread}
      draft={{
        value: drafts[thread] ?? "",
        onChange: value => setDrafts(current => ({
          ...current,
          [thread]: typeof value === "function" ? value(current[thread] ?? "") : value,
        })),
      }}
      history={{
        open: historyOpen,
        onToggle: () => setHistoryOpen(value => !value),
        title: selected?.title,
        archived: selected?.archived,
        actions: selected ? <Button size="sm" variant="ghost" onClick={() => setThreads(current =>
          current.map(entry => entry.key === thread ? { ...entry, archived: !entry.archived } : entry)
        )}>{selected.archived ? "Restore" : "Archive"}</Button> : undefined,
        content: <ChatHistoryPanel
          entries={historyEntries}
          selectedKey={thread}
          archived={archived}
          onArchivedChange={setArchived}
          search={search}
          onSearchChange={setSearch}
          module={module}
          modules={historyModules}
          onModuleChange={setModule}
          onSelect={entry => { setThread(entry.key); setHistoryOpen(false) }}
          onNewChat={() => { setThread("new"); setHistoryOpen(false) }}
          onBack={() => setHistoryOpen(false)}
        />,
      }}
      contextOptions={[{ value: "current", label: "Current page", group: "Context" }, { value: "module:inventory", label: "Inventory", group: "Modules" }]}
      selectedContext={context} onContextChange={setContext}
      context={{ module: "accounting", activeView: "Accounting", companyId: 7 }}
      config={{ title: "Lumière Assistant", guideLibraryHref: "/documents/knowledge", welcomeMessage: "Explore your business, prepare a draft, or turn an insight into a report.", skills: [
        { id: "reconcile", label: "Reconcile accounts", description: "Compare bank activity with ledger entries.", icon: "check-square", keywords: ["bank", "match"], prompt: "Review reconciliation differences and prepare suggestions for review." },
      ] }}
      onSendMessage={async (text) => ({ content: "Review the customer, invoice date, and line items before posting.\n\nThe invoice stays a draft until you confirm the action." + (text.includes("overflow") ? "\n\n" + "long-record-reference-".repeat(45) : "") })}
    />
      <NotebookPanel open={tool === "notebook"} workspaceHost={container} docked={placement === "notebook"}
        onClose={() => setTool(null)} onDockToggle={canDock("notebook") ? () => setNotebookDocked(value => !value) : undefined} />
    </>}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-muted-foreground">Accounting / Invoices</p><h1 className="mt-2 text-2xl font-semibold">New invoice</h1></div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setTool("notebook")}>Open notebook</Button>
          <Button onClick={openAssistant}><Sparkles className="size-4" />Ask Lumière</Button>
        </div>
      </div>
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
