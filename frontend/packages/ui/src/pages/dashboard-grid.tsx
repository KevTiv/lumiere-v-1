"use client"

import { forwardRef } from "react"
import type { DashboardSection } from "../lib/dashboard-types"
import { gridWidthClasses } from "../lib/dashboard-types"
import { DashboardWidgetRenderer } from "./dashboard-widget-renderer"

interface DashboardGridProps {
  sections: DashboardSection[]
  testId?: string
  widgetTestIdPrefix?: string
}

export const DashboardGrid = forwardRef<HTMLDivElement, DashboardGridProps>(
  function DashboardGrid({ sections, testId, widgetTestIdPrefix }, ref) {
    return (
      <div ref={ref} className="space-y-10" data-testid={testId}>
        {sections.map((section) => (
          <section key={section.id} className="space-y-4">
            {section.title && (
              <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {section.title}
              </h2>
            )}
            <div className="grid grid-cols-12 gap-4">
              {section.widgets.map((widget) => (
                <DashboardWidgetRenderer
                  key={widget.id}
                  widget={widget}
                  widthClass={gridWidthClasses[widget.width]}
                  testId={widgetTestIdPrefix ? `${widgetTestIdPrefix}-${widget.id}` : undefined}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  },
)
