import { Label, Input } from "admin-frontend"

export function Default() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Label htmlFor="preview-email">Email</Label>
      <Input id="preview-email" placeholder="jane@vmaas.io" />
    </div>
  )
}

export function DisabledField() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, opacity: 0.6 }}>
      <Label htmlFor="preview-disabled">Team name</Label>
      <Input id="preview-disabled" disabled placeholder="Acme Vending" />
    </div>
  )
}
