"use client"

import { useEffect, useState } from "react"
import { I18nProvider } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { ThemeProvider } from "@lumiere/ui/components/theme-provider"
import type { DashboardSection } from "@lumiere/ui/lib/dashboard-types"
import {
  createBuiltinWidgetCatalog,
  createDefaultPageLayout,
  type PageCompositionRequest,
  type PageCompositionValue,
  type PageWidgetCatalogItem,
} from "@lumiere/ui/lib/page-composition"
import { DashboardGrid } from "../../../../../packages/ui/src/pages/dashboard-grid"
import { PageComposition } from "../../../../../packages/ui/src/pages/page-composition"

const STORAGE_KEY = "lumiere-synthetic-page-composition-v1"
const CREATED_KEY = `${STORAGE_KEY}-created`

const sections: DashboardSection[] = [
  {
    id: "summary",
    title: "Sales snapshot",
    widgets: [
      {
        id: "confirmed-order-value",
        type: "kpi",
        title: "Confirmed order value",
        width: "1/3",
        data: {
          value: "€128,400",
          label: "This month",
          change: 14.8,
          changeLabel: "vs last month",
          trend: "up",
        },
      },
      {
        id: "open-orders",
        type: "kpi",
        title: "Open orders",
        width: "1/3",
        data: {
          value: 38,
          label: "Awaiting fulfillment",
          change: -8,
          changeLabel: "vs last month",
          trend: "down",
        },
      },
      {
        id: "active-customers",
        type: "kpi",
        title: "Active customers",
        width: "1/3",
        data: {
          value: 246,
          label: "Ordered this quarter",
          change: 12,
          changeLabel: "vs last quarter",
          trend: "up",
        },
      },
    ],
  },
  {
    id: "performance",
    title: "Performance",
    widgets: [
      {
        id: "order-trend",
        type: "area-chart",
        title: "Monthly order value",
        width: "full",
        data: {
          xAxisKey: "month",
          series: [{ name: "Order value", color: "#6366f1" }],
          values: [
            { month: "Jun", "Order value": 78000 },
            { month: "Jul", "Order value": 92000 },
            { month: "Aug", "Order value": 86000 },
            { month: "Sep", "Order value": 108000 },
            { month: "Oct", "Order value": 111800 },
            { month: "Nov", "Order value": 128400 },
          ],
        },
      },
    ],
  },
]

const invoiceChart: PageWidgetCatalogItem = {
  source: "saved",
  widgetId: "101",
  title: "Invoices by month",
  category: "Saved accounting insights",
  description: "Posted customer invoices grouped by invoice month.",
  defaultWidth: 6,
  scope: [
    { label: "Company", value: "Sample company" },
    { label: "Dates", value: "August–November 2026 via invoice_date" },
    { label: "Unit", value: "Records" },
  ],
  widget: {
    id: "101",
    type: "bar-chart",
    title: "Invoices by month",
    width: "1/2",
    data: {
      categoryKey: "month",
      allowDecimals: false,
      series: [{ name: "Invoices", color: "#0d9488" }],
      values: [
        { month: "Aug", Invoices: 72 },
        { month: "Sep", Invoices: 94 },
        { month: "Oct", Invoices: 108 },
        { month: "Nov", Invoices: 121 },
      ],
    },
  },
}
const paymentChart: PageWidgetCatalogItem = {
  source: "saved",
  widgetId: "102",
  title: "Invoice payment status",
  category: "Saved accounting insights",
  description: "Current invoice balance by payment status.",
  defaultWidth: 6,
  widget: {
    id: "102",
    type: "donut-chart",
    title: "Invoice payment status",
    width: "1/2",
    data: {
      segments: [
        { name: "Paid", value: 76, color: "#0d9488" },
        { name: "Partial", value: 15, color: "#6366f1" },
        { name: "Unpaid", value: 9, color: "#f59e0b" },
      ],
    },
  },
}
const createdChart: PageWidgetCatalogItem = {
  ...invoiceChart,
  widgetId: "103",
  title: "New invoice insight",
  widget: { ...invoiceChart.widget!, id: "103", title: "New invoice insight" },
}

interface FixtureSnapshot {
  value: PageCompositionValue
  revision: string | null
}

function readFixture(): FixtureSnapshot {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return { value: null, revision: null }
  try {
    return JSON.parse(stored) as FixtureSnapshot
  } catch {
    return { value: null, revision: null }
  }
}

function Preview() {
  const [hydrated, setHydrated] = useState(false)
  const [snapshot, setSnapshot] = useState<FixtureSnapshot>({
    value: null,
    revision: null,
  })
  const [created, setCreated] = useState(false)
  const [request, setRequest] = useState<PageCompositionRequest | null>(null)
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    setSnapshot(readFixture())
    setCreated(localStorage.getItem(CREATED_KEY) === "1")
    setHydrated(true)
  }, [])

  // Only this synthetic fixture persists in browser storage. Production uses the scoped API adapter.
  const save = async (
    value: PageCompositionValue,
    expectedRevision: string | null,
  ) => {
    if (readFixture().revision !== expectedRevision)
      throw new Error("The synthetic page changed elsewhere.")
    const next = {
      value,
      revision: String(BigInt(expectedRevision ?? "0") + 1n),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setSnapshot(next)
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Sales workspace
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Your metrics, your page
          </h1>
          <p className="text-sm text-muted-foreground">
            Arrange your dashboard and add the insights you use every day.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setRequest({
                id: crypto.randomUUID(),
                kind: "add_widget",
                widgetKey: "saved:102",
                prompt: "Add a chart showing invoice payment status",
              })
            }
          >
            Simulate assistant add
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              setRequest({
                id: crypto.randomUUID(),
                kind: "add_widget",
                prompt: "Show invoice metrics on this page",
              })
            }
          >
            Simulate assistant request
          </Button>
        </div>
      </header>
      <p
        data-testid="page-composition-fixture"
        data-hydrated={hydrated}
        className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground"
      >
        Synthetic editor preview. Browser storage is a test adapter; this page
        performs no ERP API operations.
      </p>
      {hydrated ? (
        <PageComposition
          key={generation}
          value={snapshot.value}
          revision={snapshot.revision}
          defaultValue={createDefaultPageLayout(sections)}
          startingLayouts={[
            {
              id: "work-review",
              label: "Work review",
              widgets: [
                { widgetId: "open-orders", width: 6 },
                { widgetId: "active-customers", width: 6 },
              ],
            },
            {
              id: "period-review",
              label: "Period review",
              widgets: [
                { widgetId: "order-trend", width: 8 },
                { widgetId: "confirmed-order-value", width: 4 },
              ],
            },
          ]}
          persistenceNote="This preview saves your layout in this browser."
          catalog={[
            ...createBuiltinWidgetCatalog(sections),
            invoiceChart,
            paymentChart,
            ...(created ? [createdChart] : []),
          ]}
          onSave={save}
          onCreateWidget={async () => {
            setCreated(true)
            localStorage.setItem(CREATED_KEY, "1")
            return createdChart
          }}
          request={request}
          onRequestHandled={() => setRequest(null)}
        >
          <DashboardGrid sections={sections} />
        </PageComposition>
      ) : (
        <p>Loading preview…</p>
      )}
      <footer className="flex items-center justify-between border-t pt-4 text-xs text-muted-foreground">
        <span>Sample company · EUR · November 2026</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY)
            localStorage.removeItem(CREATED_KEY)
            setSnapshot({ value: null, revision: null })
            setCreated(false)
            setRequest(null)
            setGeneration((value) => value + 1)
          }}
        >
          Reset synthetic fixture
        </Button>
      </footer>
      <output className="sr-only" data-testid="fixture-saved-layout">
        {JSON.stringify(snapshot)}
      </output>
    </main>
  )
}

export default function Page() {
  return (
    <I18nProvider language="en">
      <ThemeProvider
        defaultTheme="light"
        storageKey="lumiere-synthetic-page-composition-theme"
      >
        <Preview />
      </ThemeProvider>
    </I18nProvider>
  )
}
