import { config } from "@/lib/config"
import { headers } from "next/headers"

interface Product {
  id: string
  tenantId: string
  name: string
  price: number
  createdAt: string
}

export default async function LagerPage() {
  const headersList = await headers()

  const products: Product[] = await fetch(
    config.BACKEND_URL + "/api/products",
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        cookie: headersList.get("cookie") ?? "",
      },
    }
  ).then((res) => res.json())

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Lager</h1>
      <p className="text-muted-foreground">
        This is the Lager page. You can add your content here.
      </p>
      {products.map((product) => (
        <div key={product.id} className="rounded border p-4">
          <h2 className="text-xl font-semibold">{product.name}</h2>
          <p>ID: {product.id}</p>
          <p>Price: {product.price}</p>
        </div>
      ))}
    </div>
  )
}
