import { Badge } from "admin-frontend"

export function Variants() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="ghost">Ghost</Badge>
    </div>
  )
}

export function StatusExamples() {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Badge variant="secondary">Online</Badge>
      <Badge variant="destructive">Offline</Badge>
      <Badge variant="outline">Maintenance</Badge>
    </div>
  )
}
