import { Textarea } from "admin-frontend"

export function Default() {
  return <Textarea placeholder="Add a note about this machine…" rows={4} />
}

export function WithValue() {
  return (
    <Textarea
      defaultValue={"Machine restocked on Tuesday.\nNext visit scheduled for Friday."}
      rows={4}
    />
  )
}

export function Disabled() {
  return <Textarea placeholder="Disabled" rows={3} disabled />
}
