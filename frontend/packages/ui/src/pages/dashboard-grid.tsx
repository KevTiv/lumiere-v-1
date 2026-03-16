"use client"

import type { DashboardSection } from "../lib/dashboard-types"
import { gridWidthClasses } from "../lib/dashboard-types"
import { DashboardWidgetRenderer } from "./dashboard-widget-renderer"

interface DashboardGridProps {
  sections: DashboardSection[]
}

export function DashboardGrid({ sections }: DashboardGridProps) {
  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <section key={section.id}>
          {section.title && (
            <h2 className="text-lg font-semibold mb-4 text-foreground/90">
              {section.title}
            </h2>
          )}
          <div className="grid grid-cols-12 gap-4 lg:gap-6">
            {section.widgets.map((widget) => (
              <DashboardWidgetRenderer
                key={widget.id}
                widget={widget}
                widthClass={gridWidthClasses[widget.width]}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
