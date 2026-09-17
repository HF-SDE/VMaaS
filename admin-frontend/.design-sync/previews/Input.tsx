import { Input } from "admin-frontend"

export function Default() {
  return <Input placeholder="Email address" />
}

export function WithValue() {
  return <Input defaultValue="jane@vmaas.io" />
}

export function Disabled() {
  return <Input placeholder="Disabled input" disabled />
}
