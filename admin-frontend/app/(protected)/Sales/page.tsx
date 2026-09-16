import Loader from "@/components/loader/loader"
import { fetchData } from "@/lib/data/data-fetch"
import { SalesResponse } from "@/types/responses"
import { Suspense } from "react"

export default function SalesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Sales</h1>
      <Suspense fallback={<Loader />}>
        <SalesList />
      </Suspense>
    </div>
  )
}

async function SalesList() {
  const [err, sales] = await fetchData<SalesResponse[]>("/api/sales")

  if (err) return <div>Error loading sales data: {err.reason}</div>

  return (
    <ul>
      {sales.map((sale) => (
        <li key={sale.id} className="mb-2 flex gap-3 rounded border p-4">
          <p>{sale.product?.name}</p>
          <p>{Number(sale.price)}</p>
          <p>{new Date(sale.createdAt).toLocaleString()}</p>
          <p>{sale.machine.name}</p>
          <p>{sale.machine.siteId}</p>
        </li>
      ))}
    </ul>
  )
}
