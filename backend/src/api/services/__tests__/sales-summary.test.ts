import { summariseSales } from "@/api/services/sales.service";

import { describe, expect, it } from "vitest";

const NOW = new Date("2026-03-15T12:00:00.000Z");
const PRODUCT = "66666666-6666-4666-8666-666666666666";

function sale(createdAt: string, price: number, productId: string | null = PRODUCT, name = "Cola Zero") {
  return {
    price,
    createdAt: new Date(createdAt),
    productId,
    product: productId ? { name } : null,
  };
}

describe("summariseSales", () => {
  it("produces one entry per day in the window, oldest first, even with no sales", () => {
    const summary = summariseSales([], 30, NOW);

    expect(summary.daily).toHaveLength(30);
    expect(summary.daily[0]!.date).toBe("2026-02-14");
    expect(summary.daily.at(-1)!.date).toBe("2026-03-15");
  });

  it("zero-fills a day with no sales instead of omitting it", () => {
    const summary = summariseSales([sale("2026-03-15T08:00:00.000Z", 10)], 30, NOW);
    const quiet = summary.daily.find((day) => day.date === "2026-03-14");

    expect(quiet).toEqual({ date: "2026-03-14", revenue: 0, count: 0 });
  });

  it("buckets a sale late in the UTC day into that day, not the next", () => {
    const summary = summariseSales([sale("2026-03-14T23:59:00.000Z", 10)], 30, NOW);

    expect(summary.daily.find((day) => day.date === "2026-03-14")!.count).toBe(1);
    expect(summary.daily.find((day) => day.date === "2026-03-15")!.count).toBe(0);
  });

  it("counts only the current UTC day in today's tile", () => {
    const summary = summariseSales(
      [sale("2026-03-15T00:30:00.000Z", 10), sale("2026-03-14T23:30:00.000Z", 99)],
      30,
      NOW,
    );

    expect(summary.today).toEqual({ revenue: 10, count: 1 });
  });

  it("rolls the 7-day and 30-day tiles up from the same sales", () => {
    const summary = summariseSales(
      [sale("2026-03-15T08:00:00.000Z", 10), sale("2026-03-01T08:00:00.000Z", 5)],
      30,
      NOW,
    );

    expect(summary.last7Days).toEqual({ revenue: 10, count: 1 });
    expect(summary.last30Days).toEqual({ revenue: 15, count: 2 });
  });

  it("ranks the top products by revenue, not by count", () => {
    const summary = summariseSales(
      [
        sale("2026-03-15T08:00:00.000Z", 5, "a", "Cheap"),
        sale("2026-03-15T09:00:00.000Z", 5, "a", "Cheap"),
        sale("2026-03-15T10:00:00.000Z", 30, "b", "Pricey"),
      ],
      30,
      NOW,
    );

    expect(summary.topProducts.map((product) => product.name)).toEqual(["Pricey", "Cheap"]);
    expect(summary.topProducts[0]).toEqual({ productId: "b", name: "Pricey", count: 1, revenue: 30 });
  });

  it("caps the top products at five", () => {
    const sales = Array.from({ length: 8 }, (_, index) =>
      sale("2026-03-15T08:00:00.000Z", index + 1, `product-${index}`, `Product ${index}`),
    );

    expect(summariseSales(sales, 30, NOW).topProducts).toHaveLength(5);
  });

  it("counts a sale whose product was deleted toward revenue but leaves it out of top products", () => {
    const summary = summariseSales([sale("2026-03-15T08:00:00.000Z", 40, null)], 30, NOW);

    expect(summary.today.revenue).toBe(40);
    expect(summary.topProducts).toEqual([]);
  });
});
