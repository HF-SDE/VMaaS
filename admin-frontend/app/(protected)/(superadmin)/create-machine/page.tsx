import { Suspense } from "react"
import Link from "next/link"
import { Blocks, ChevronRight } from "lucide-react"

import Loader from "@/components/loader/loader"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { fetchData } from "@/lib/data/data-fetch"
import { MachinesWithoutTenants } from "@/types/responses"

import { machineLoadErrorMessage } from "./messages"

/** Machines that haven't been given to a tenant yet. Clicking one opens its slot layout editor. */
export default async function CreateMachinePage() {
  return (
    <div className="container mx-auto py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Set up machines</h1>
        <p className="text-muted-foreground">
          Machines without a tenant. Select a machine to set up its slot layout.
        </p>
      </div>

      <Suspense fallback={<Loader text="Loading machines..." />}>
        <MachinesList />
      </Suspense>
    </div>
  )
}

async function MachinesList() {
  const [error, machines] = await fetchData<MachinesWithoutTenants[]>(
    "/api/machines/without-tenant"
  )

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {machineLoadErrorMessage(error.status)}
      </p>
    )
  }

  if (machines.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Blocks />
          </EmptyMedia>
          <EmptyTitle>No machines to set up</EmptyTitle>
          <EmptyDescription>
            Every machine has already been given to a tenant.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ItemGroup className="max-w-2xl gap-2">
      {machines.map((machine) => (
        <Item
          key={machine.id}
          variant="outline"
          render={<Link href={`/create-machine/${machine.id}`} />}
        >
          <ItemMedia variant="icon">
            <Blocks />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{machine.name}</ItemTitle>
            <ItemDescription>
              {machine.site.name} · {slotCountLabel(machine.slots.length)}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <ChevronRight className="size-4 text-muted-foreground" />
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  )
}

function slotCountLabel(count: number) {
  if (count === 0) return "No slots yet"
  return count === 1 ? "1 slot" : `${count} slots`
}
