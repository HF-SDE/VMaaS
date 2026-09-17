import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import Loader from "@/components/loader/loader"
import { fetchData } from "@/lib/data/data-fetch"
import { MachineWithoutTenant } from "@/types/responses"

import { EditorSlot, SlotGridEditor } from "../components/slot-grid-editor"
import { machineLoadErrorMessage } from "../messages"

/** The slot layout editor for one machine without a tenant */
export default async function MachineLayoutPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <div className="container mx-auto py-10">
      <Link
        href="/create-machine"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to machines
      </Link>

      <Suspense fallback={<Loader text="Loading machine..." />}>
        <MachineLayoutLoader params={params} />
      </Suspense>
    </div>
  )
}

async function MachineLayoutLoader({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const [error, machine] = await fetchData<MachineWithoutTenant>(
    `/api/machines/without-tenant/${id}`
  )

  if (error) {
    // 400 is a malformed id, which can't match a machine either
    if (error.status === 404 || error.status === 400) notFound()

    return (
      <p role="alert" className="text-sm text-destructive">
        {machineLoadErrorMessage(error.status)}
      </p>
    )
  }

  const initialSlots: EditorSlot[] = machine.slots.map((slot) => ({
    key: slot.id,
    ...slot,
  }))

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">{machine.name}</h1>
        <p className="text-muted-foreground">
          {`Placed at ${machine.site.name}. Set up the slot layout of the machine.`}
        </p>
      </div>

      <SlotGridEditor machineId={machine.id} initialSlots={initialSlots} />
    </>
  )
}
