import Link from "next/link"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import { getLowStockSlots } from "@/lib/data/slots"
import { requireAccess } from "@/lib/dal"
import { hasPermission } from "@/lib/permissions"
import { Progress } from "@/components/ui/progress"
import { SectionError } from "./section-error"
import { ShowMoreList } from "./show-more-list"

/**
 * The slots that need a visit, emptiest first. How many there are, and how the
 * fleet is doing, are the KPI row's job; this is the queue itself.
 */
export async function RestockQueueSection() {
  const session = await requireAccess()
  if (!hasPermission(session, PERMISSIONS.MACHINE_READ)) return null

  const [error, lowStock] = await getLowStockSlots()

  return (
    <section>
      <h2 className="text-lg font-semibold">Restock queue</h2>

      {error ? (
        <SectionError message="Couldn't load stock levels." />
      ) : lowStock.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Every slot is stocked.
        </p>
      ) : (
        <ShowMoreList className="mt-4 divide-y rounded-md border">
          {lowStock.map((slot) => (
            <li key={slot.slotId} className="p-3 text-sm">
              <Link
                href={`/machines/${slot.machineId}`}
                className="hover:underline"
              >
                <div className="flex items-center justify-between gap-4">
                  <span>
                    {slot.machineName} · slot {slot.slotNumber} ·{" "}
                    {slot.productName ?? "No product"}
                  </span>
                  <span
                    className={
                      slot.quantity === 0
                        ? "font-medium text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {slot.quantity}/{slot.capacity}
                    {slot.quantity === 0 ? " · empty" : ""}
                  </span>
                </div>
                <Progress
                  className="mt-2"
                  value={(slot.quantity / slot.capacity) * 100}
                />
              </Link>
            </li>
          ))}
        </ShowMoreList>
      )}
    </section>
  )
}
