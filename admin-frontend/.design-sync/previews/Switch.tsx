import { Switch, Label } from "admin-frontend"

export function Default() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Switch id="preview-switch" />
      <Label htmlFor="preview-switch">Enable notifications</Label>
    </div>
  )
}

export function Checked() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Switch id="preview-switch-on" defaultChecked />
      <Label htmlFor="preview-switch-on">Maintenance mode</Label>
    </div>
  )
}

export function Small() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Switch id="preview-switch-sm" size="sm" defaultChecked />
      <Label htmlFor="preview-switch-sm">Compact switch</Label>
    </div>
  )
}
