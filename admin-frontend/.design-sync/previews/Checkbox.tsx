import { Checkbox, Label } from "admin-frontend"

export function Default() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Checkbox id="preview-terms" />
      <Label htmlFor="preview-terms">Send restock alerts</Label>
    </div>
  )
}

export function Checked() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Checkbox id="preview-checked" defaultChecked />
      <Label htmlFor="preview-checked">Auto-approve refunds under $5</Label>
    </div>
  )
}

export function Disabled() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Checkbox id="preview-disabled" disabled />
      <Label htmlFor="preview-disabled">Disabled option</Label>
    </div>
  )
}
