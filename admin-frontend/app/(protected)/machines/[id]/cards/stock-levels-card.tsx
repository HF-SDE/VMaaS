"use client"

import { Label, Pie, PieChart } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import type { MachineKpi } from "@vmaas/shared/types/machine"

/**
 * How full the machine is right now.
 *
 * No trend badge: stock is a level, not a total over a window, so there is no
 * earlier window to hold it against — the donut is what makes the figure
 * readable at a glance instead. The empty half is a neutral rather than a second
 * hue: it is the remainder of one measure, not a category competing with it.
 *
 * A machine with no slots configured yet is a real state, not an error, so it
 * shows an em dash rather than a division by zero.
 */
const chartConfig = {
  units: { label: "Units" },
  loaded: { label: "Loaded", color: "var(--chart-1)" },
  empty: { label: "Empty space", color: "var(--muted)" },
} satisfies ChartConfig

export function StockLevelsCard({ kpi }: { kpi: MachineKpi }) {
  const { slots, quantity, capacity, emptySlots } = kpi.stock
  const quantityValue = Number(quantity)
  const capacityValue = Number(capacity)

  const percent =
    Number.isFinite(capacityValue) && capacityValue > 0
      ? Math.round((quantityValue / capacityValue) * 100)
      : null

  const chartData = [
    {
      state: "loaded",
      units: Math.max(quantityValue, 0),
      fill: "var(--color-loaded)",
    },
    {
      state: "empty",
      units: Math.max(capacityValue - quantityValue, 0),
      fill: "var(--color-empty)",
    },
  ]

  return (
    <Card className="@container/card flex flex-col gap-2">
      <CardHeader>
        <CardDescription>Stock level</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 items-center pb-0">
        {percent === null ? (
          <div className="text-2xl font-semibold tabular-nums">—</div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="mx-auto aspect-square max-h-35 w-full"
          >
            <PieChart>
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent hideLabel />}
              />

              <Pie
                data={chartData}
                dataKey="units"
                nameKey="state"
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={65}
                strokeWidth={2}
              >
                <Label
                  content={({ viewBox }) => {
                    if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) {
                      return null
                    }

                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-2xl font-semibold tabular-nums"
                        >
                          {percent}%
                        </tspan>

                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy ?? 0) + 20}
                          className="fill-muted-foreground text-xs"
                        >
                          full
                        </tspan>
                      </text>
                    )
                  }}
                />
              </Pie>
            </PieChart>
          </ChartContainer>
        )}
      </CardContent>
      <CardFooter className="flex-col items-start gap-1.5 text-sm">
        <div className="line-clamp-1 font-medium">
          {slots === 0
            ? "No slots configured"
            : `${quantity} of ${capacity} units loaded`}
        </div>
        <div className="text-muted-foreground">
          {slots === 0
            ? "Add slots to track stock"
            : emptySlots === 0
              ? `All ${slots} slots stocked`
              : `${emptySlots} of ${slots} slots empty`}
        </div>
      </CardFooter>
    </Card>
  )
}
