import { describe, expect, it } from "vitest"

import { mapDashboardWidgets, withDashboardSections } from "./dashboard-sections"
import type { ModuleConfig } from "./module-types"

const config: ModuleConfig = {
  id: "test",
  title: "Test",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: [
        {
          id: "main",
          widgets: [
            {
              id: "total",
              type: "kpi",
              title: "Total",
              width: "1/3",
              data: { label: "Total", value: 1 },
            },
          ],
        },
      ],
    },
    { id: "records", label: "Records", type: "entity" },
  ],
}

describe("dashboard sections", () => {
  it("maps only dashboard widgets and returns an empty list when absent", () => {
    const sections = mapDashboardWidgets(config, (widget) =>
      widget.type === "kpi" ? { ...widget, data: { ...widget.data, value: 2 } } : widget,
    )
    expect(sections[0]?.widgets[0]).toMatchObject({ data: { value: 2 } })
    expect(mapDashboardWidgets({ ...config, tabs: [config.tabs[1]!] }, (widget) => widget)).toEqual([])
  })

  it("replaces dashboard sections without changing other tabs", () => {
    const sections = mapDashboardWidgets(config, (widget) => widget)
    const result = withDashboardSections(config, sections)
    expect(result.tabs[0]?.sections).toBe(sections)
    expect(result.tabs[1]).toBe(config.tabs[1])
  })
})
