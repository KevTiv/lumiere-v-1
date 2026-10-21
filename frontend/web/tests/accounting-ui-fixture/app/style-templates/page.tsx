"use client"

import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider } from "@lumiere/i18n"
import { ErpSessionProvider } from "@lumiere/erp-session"
import type { PreviewResponse } from "@lumiere/presentation-core/preview-contract"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"
import { ThemeProvider, useTheme } from "../../../../../packages/ui/src/components/theme-provider"
import { DashboardWorkspace } from "../../../../../packages/ui/src/pages/dashboard-workspace"
import { DashboardSidebar } from "../../../../../packages/ui/src/pages/dashboard-sidebar"
import { ModuleView } from "../../../../../packages/ui/src/pages/module-view"
import { DashboardHeader } from "../../../../../packages/ui/src/pages/dashboard-header"
import { ModularForm } from "../../../../../packages/ui/src/forms/modular-form"
import { Button } from "../../../../../packages/ui/src/components/button"
import { ComposedCollectionDetailHost } from "../../../../../packages/ui/src/composed/ComposedCollectionDetailHost"
import type { FormConfig } from "../../../../../packages/ui/src/lib/form-types"
import type { ModuleConfig } from "../../../../../packages/ui/src/lib/module-types"

const form: FormConfig = {
  id: "template-record", title: "Prepare a supplier onboarding record for the international operations team",
  description: "Synthetic static form using the shared renderer and normal field configuration.", submitLabel: "Save synthetic record",
  sections: [
    { id: "identity", title: "Record identity and ownership", description: "Shared form fields inherit the active palette and responsive sizing.", fields: [
      { id: "reference", name: "reference", label: "Reference", type: "text", required: true, width: "1/2" },
      { id: "department", name: "department", label: "Department", type: "select", width: "1/2", defaultValue: "operations", options: [{ value: "operations", label: "International operations" }, { value: "finance", label: "Finance and accounting" }] },
      { id: "contact", name: "contact", label: "Contact name", type: "text", width: "1/2" },
      { id: "email", name: "email", label: "Contact email", type: "email", width: "1/2" },
    ] },
    { id: "details", title: "Operational details", fields: [
      { id: "address", name: "address", label: "Business address", type: "textarea", rows: 4 },
      { id: "country", name: "country", label: "Country", type: "text", width: "1/2" },
      { id: "postal", name: "postal", label: "Postal code", type: "text", width: "1/2" },
      { id: "notes", name: "notes", label: "Review notes", type: "textarea", rows: 4 },
    ] },
  ],
}

const preview: PreviewResponse = {
  definition: {
    schemaVersion: 1, moduleId: "supplier-hub", title: "Supplier hub", baseRevision: null,
    applicationContract: "synthetic-style-fixture-v1", componentCatalogVersion: 1,
    pages: [{ id: "directory", title: "Persisted supplier collection and linked record detail", nodes: [
      { kind: "collection", id: "suppliers", slot: "primary", component: { id: "collection", version: 1 }, resource: "suppliers", fields: ["reference", "company", "owner", "review"], pageSize: 25 },
      { kind: "detail", id: "supplier-detail", slot: "secondary", component: { id: "detail", version: 1 }, sourceNodeId: "suppliers", fields: ["reference", "company", "owner", "review"] },
    ] }],
  },
  collections: [{ pageId: "directory", nodeId: "suppliers", truncated: true, rows: [{ id: "supplier-1", fields: [
    { field: "reference", value: "SUPPLIER-ALPHA-001" }, { field: "company", value: "Synthetic international supplier organisation" },
    { field: "owner", value: "very-long-synthetic-reference-without-breaks-".repeat(4) }, { field: "review", value: "Ready for review" },
  ] }] }],
}

function Templates() {
  const [hydrated, setHydrated] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState("records")
  const { theme, setTheme, palette, setPalette } = useTheme()
  useEffect(() => setHydrated(true), [])
  const config: ModuleConfig = {
    id: "style-templates", title: "Supplier onboarding and international operations workspace with a deliberately long responsive title",
    description: "Synthetic UI fixture — no backend operations. This module, static form and persisted presentation share the production renderers.",
    defaultTab: "records", tabs: [
      { id: "records", label: "Supplier records", type: "entity", createForm: form, createLabel: "New supplier record", createAction: "syntheticCreate",
        entityConfig: { id: "synthetic-suppliers", title: "Supplier register", view: { mode: "table", rowKey: "id", searchable: true, searchKeys: ["reference", "name"], columns: [
          { key: "reference", label: "Reference" }, { key: "name", label: "Organisation" }, { key: "state", label: "Review state", type: "badge" },
        ] } } },
      { id: "form", label: "Static form", type: "custom", customContent: <ModularForm config={{ ...form, id: "template-inline", layout: "card" }} onSubmit={() => setSaved(true)} /> },
    ],
  }
  return <DashboardWorkspace sidebar={<DashboardSidebar userProfile={{ name: "Synthetic Designer" }} />} onOpenSearch={() => {}}>
    <p className="mb-4 text-xs text-muted-foreground" data-testid="style-fixture-disclosure" data-hydrated={hydrated}>Synthetic UI fixture — no backend operations</p>
    <div className="mb-5 flex flex-wrap gap-2" aria-label="Synthetic appearance controls">
      <Button variant="outline" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>Light theme</Button>
      <Button variant="outline" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>Dark theme</Button>
      <Button variant="outline" aria-pressed={palette === "default"} onClick={() => setPalette("default")}>Lumière palette</Button>
      <Button variant="outline" aria-pressed={palette === "ocean"} onClick={() => setPalette("ocean")}>Ocean palette</Button>
    </div>
    {saved && <p role="status">Synthetic supplier saved</p>}
    <section className="mb-8" aria-label="Responsive action label example"><DashboardHeader title="Shared action layouts" actions={[{
      label: "Create the complete supplier onboarding record and notify the international operations and accounting review team with supporting information",
      testId: "template-long-action", onClick: () => setSaved(true),
    }]} /></section>
    <ModuleView config={config} activeTab={tab} onActiveTabChange={setTab} data={{ records: [{ id: "supplier-1", reference: "SUPPLIER-ALPHA-001", name: "Synthetic international supplier", state: "Review" }] }} dataState={{ records: { status: "ready" } }} onFormSubmit={() => setSaved(true)} />
    <section className="mt-8" aria-label="Persisted presentation template"><ComposedCollectionDetailHost preview={preview} /></section>
  </DashboardWorkspace>
}

export default function StyleTemplatesFixture() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ErpSessionProvider value={{ identity: null, connected: false }}><ThemeProvider defaultTheme="light"><Templates /></ThemeProvider></ErpSessionProvider></RBACProvider></I18nProvider></QueryClientProvider>
}
