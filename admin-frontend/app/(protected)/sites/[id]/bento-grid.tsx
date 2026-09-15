import { Card } from "@/components/ui/card"

interface SiteDetailsPageParams {
  id: string
  name: string
  map: {
    lat: number
    long: number
  }
}
export default function BentoGrid() {
  return (
    <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
      <Card className="col-span-1 min-h-40">Card Content</Card>{" "}
      <Card className="col-span-2 min-h-40">Card Content</Card>{" "}
      <Card className="col-span-2 row-span-2 min-h-40">Card</Card>
      <Card className="col-span-2 min-h-40">Card Content</Card>{" "}
      <Card className="col-span-1 min-h-40">Card Content</Card>{" "}
    </div>
  )
}
