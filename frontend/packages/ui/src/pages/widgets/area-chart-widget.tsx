"use client"

import { useId } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts"
import type { AreaChartWidget as AreaChartWidgetType } from "../../lib/dashboard-types"

export function AreaChartWidget({ data }: { data: AreaChartWidgetType["data"] }) {
  // Labels may contain whitespace/punctuation and repeat across charts. Neither is a valid unique SVG reference.
  const gradientPrefix = `area-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data.values} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            {data.series.map((s, index) => (
              <linearGradient key={s.name} id={`${gradientPrefix}-${index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            vertical={false}
          />
          <XAxis
            dataKey={data.xAxisKey}
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            allowDecimals={data.allowDecimals}
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `${value >= 1000 ? `${value / 1000}k` : value}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              color: "hsl(var(--foreground))",
            }}
          />
          {data.series.map((s, index) => (
            <Area
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#${gradientPrefix}-${index})`}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
