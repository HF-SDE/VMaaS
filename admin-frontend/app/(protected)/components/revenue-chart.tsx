"use client"

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import type { SalesDayPoint } from "@vmaas/shared/types/sale"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

/** One series, so no legend — the heading above the chart names it. The colour
 *  is the theme's own chart token, which has a step for each mode. */
const config = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
} satisfies ChartConfig

export function RevenueChart({ daily }: { daily: SalesDayPoint[] }) {
  return (
    <ChartContainer config={config} className="h-48 w-full">
      <AreaChart data={daily} margin={{ left: 12, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          // The year is constant across the window and only costs width.
          tickFormatter={(value: string) => value.slice(5)}
        />
        <YAxis tickLine={false} axisLine={false} width={48} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          dataKey="revenue"
          type="monotone"
          stroke="var(--color-revenue)"
          strokeWidth={2}
          fill="var(--color-revenue)"
          fillOpacity={0.2}
          // A dot per day is 30 marks nobody reads; the tooltip gives the value.
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}

/** The same series reduced to its shape: no axes, no grid, no tooltip. It sits
 *  under a KPI figure, where the number is the message and the line is only
 *  there to say which way it has been going. */
export function RevenueSparkline({ daily }: { daily: SalesDayPoint[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-10 w-full">
      <AreaChart data={daily} margin={{ top: 2, bottom: 2 }}>
        <Area
          dataKey="revenue"
          type="monotone"
          stroke="var(--color-revenue)"
          strokeWidth={1.5}
          fill="var(--color-revenue)"
          fillOpacity={0.15}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}
