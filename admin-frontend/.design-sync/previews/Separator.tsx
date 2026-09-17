import { Separator } from "admin-frontend"

export function Horizontal() {
  return (
    <div style={{ width: 240 }}>
      <p style={{ margin: 0 }}>Sales</p>
      <Separator style={{ margin: "12px 0" }} />
      <p style={{ margin: 0 }}>Inventory</p>
    </div>
  )
}

export function Vertical() {
  return (
    <div style={{ display: "flex", alignItems: "center", height: 32, gap: 12 }}>
      <span>Sites</span>
      <Separator orientation="vertical" />
      <span>Machines</span>
      <Separator orientation="vertical" />
      <span>Alerts</span>
    </div>
  )
}
