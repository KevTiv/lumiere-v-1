"use client"

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts"
import type { DonutChartWidget as DonutChartWidgetType } from "../../lib/dashboard-types"

export function DonutChartWidget({ data }: { data: DonutChartWidgetType["data"] }) {
  const innerRadius = data.innerRadius ?? 60

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data.segments}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={100}
            paddingAngle={2}
            onClick={(segment) => {
              if (data.onSegmentClick && segment?.name) {
                data.onSegmentClick(String(segment.name))
              }
            }}
            style={{ cursor: data.onSegmentClick ? "pointer" : "default" }}
          >
            {data.segments.map((segment) => (
              <Cell key={segment.name} fill={segment.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              color: "hsl(var(--foreground))",
            }}
          />
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            formatter={(value) => (
              <span style={{ color: "hsl(var(--foreground))" }}>{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
