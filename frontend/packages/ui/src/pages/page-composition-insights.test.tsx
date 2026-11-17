import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DashboardWidget } from "../lib/dashboard-types"
import {
  createBuiltinWidgetCatalog,
  createDefaultPageLayout,
  type PageCompositionValue,
} from "../lib/page-composition"
import { PageComposition } from "./page-composition"
import {
  PageCompositionHostProvider,
  type PageCompositionMountProps,
} from "./page-composition-host"
import { ModuleInsights } from "../../../../web/components/module-insights"
import type {
  InsightModule,
  ModuleInsightInput,
} from "../../../../web/lib/module-insights-model"
import {
  moduleInsightNow,
  moduleInsightRows,
} from "../../../../web/tests/accounting-ui-fixture/module-insights-fixtures"

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(
        /\{\{(\w+)\}\}/g,
        (_, field: string) => String(options?.[field] ?? ""),
      ),
  }),
}))
vi.mock("@lumiere/query-hooks/hooks/organization-company", () => ({
  useCompanies: () => ({ data: [] }),
}))
vi.mock("../../../../web/lib/use-history-period", async () => {
  const { useState } = await import("react")
  return {
    useHistoryPeriod: () => {
      const [period, setPeriod] = useState("all")
      return [period, setPeriod, false]
    },
  }
})
vi.mock("./dashboard-widget-renderer", () => ({
  DashboardWidgetRenderer: ({ widget }: { widget: DashboardWidget }) => {
    if (widget.type === "custom") {
      const Component = widget.component
      return <Component data={widget.data} />
    }
    return (
      <div role="img" aria-label={widget.title}>
        {widget.title}
      </div>
    )
  },
}))

const mounted = vi.fn<(props: PageCompositionMountProps) => void>()

function TestHost(props: PageCompositionMountProps) {
  mounted(props)
  const [value, setValue] = useState<PageCompositionValue>(null)
  const sections = props.sections ?? []
  return (
    <PageComposition
      value={value}
      defaultValue={createDefaultPageLayout(sections)}
      catalog={createBuiltinWidgetCatalog(sections)}
      onSave={async (next) => {
        setValue(next)
      }}
    >
      {props.children}
    </PageComposition>
  )
}

function input(module: InsightModule, denied = false): ModuleInsightInput {
  return {
    module,
    organizationId: 1,
    companyId: 1,
    records: {
      rows: moduleInsightRows(module),
      state: { status: denied ? "denied" : "ready" },
    },
    currencies: {
      rows: [
        { id: 1, code: "EUR", decimalPlaces: 2 },
        { id: 2, code: "USD", decimalPlaces: 2 },
      ],
      state: { status: "ready" },
    },
  }
}

function Page({
  module,
  denied = false,
}: {
  module: InsightModule
  denied?: boolean
}) {
  return (
    <PageCompositionHostProvider component={TestHost}>
      <ModuleInsights input={input(module, denied)} now={moduleInsightNow} />
    </PageCompositionHostProvider>
  )
}

afterEach(() => {
  cleanup()
  mounted.mockClear()
})

describe("module insight composition integration", () => {
  it.each(["sales", "crm", "purchasing", "expenses", "reports"] as const)(
    "registers independent %s cards, keeping scope controls and current source states after saving",
    async (module) => {
      const view = render(<Page module={module} />)
      const mount = mounted.mock.calls.at(-1)?.[0]
      expect(mount?.moduleId).toBe(module)
      expect(mount?.pageId).toBe("dashboard")
      expect(mount?.sections).toHaveLength(8)
      const defaults = createDefaultPageLayout(mount?.sections ?? [])
      expect(defaults.slice(0, 4).map((widget) => widget.width)).toEqual([
        3, 3, 3, 3,
      ])
      expect(
        createBuiltinWidgetCatalog(mount?.sections ?? []).every(
          (widget) => widget.title.length > 0,
        ),
      ).toBe(true)
      expect(
        screen.getAllByTestId(`${module}-insights-currentValue`),
      ).toHaveLength(1)
      expect(screen.queryByText("FOREIGN COMPANY MUST STAY HIDDEN")).toBeNull()

      fireEvent.click(screen.getByRole("button", { name: "Edit page" }))
      fireEvent.click(
        screen.getByRole("button", {
          name: `Remove moduleInsights.modules.${module}.currentCount`,
        }),
      )
      fireEvent.click(screen.getByRole("button", { name: "Done" }))
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Edit page" })).toBeTruthy(),
      )
      expect(screen.queryByTestId(`${module}-insights-currentCount`)).toBeNull()
      expect(
        screen.queryByRole("link", { name: "Available history" }),
      ).toBeNull()
      const recordsLink = screen.getByRole("link", {
        name: `moduleInsights.modules.${module}.browse`,
      })
      const recordsUrl = new URL(
        recordsLink.getAttribute("href")!,
        "https://example.test",
      )
      expect(recordsUrl.pathname).toBe(`/${module}`)
      expect(recordsUrl.searchParams.get("period")).toBe("all")
      expect(recordsUrl.searchParams.getAll("filter")).toContain("companyId:1")
      expect(screen.getByLabelText("moduleInsights.period")).toBeTruthy()
      if (module !== "reports")
        expect(screen.getByLabelText("moduleInsights.currency")).toBeTruthy()

      view.rerender(<Page module={module} denied />)
      expect(
        screen.getByTestId(`${module}-insights-currentValue`).textContent,
      ).toContain("moduleInsights.source.denied")
      expect(screen.queryByRole("img")).toBeNull()
      expect(
        screen.queryByTestId(`${module}-insights-queue-records`),
      ).toBeNull()

      fireEvent.click(screen.getByRole("button", { name: "Edit page" }))
      fireEvent.click(screen.getByRole("button", { name: "Reset to default" }))
      fireEvent.click(screen.getByRole("button", { name: "Done" }))
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Edit page" })).toBeTruthy(),
      )
      expect(
        screen.getAllByTestId(`${module}-insights-currentCount`),
      ).toHaveLength(1)
    },
  )
})
