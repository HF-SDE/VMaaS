import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} from "admin-frontend"

export function Default() {
  return (
    <Select defaultValue="online">
      <SelectTrigger style={{ width: 220 }}>
        <SelectValue placeholder="Filter by status" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Machine status</SelectLabel>
          <SelectItem value="online">Online</SelectItem>
          <SelectItem value="offline">Offline</SelectItem>
          <SelectItem value="maintenance">Maintenance</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function Open() {
  return (
    <Select defaultValue="offline" defaultOpen>
      <SelectTrigger style={{ width: 220 }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Machine status</SelectLabel>
          <SelectItem value="online">Online</SelectItem>
          <SelectItem value="offline">Offline</SelectItem>
          <SelectItem value="maintenance">Maintenance</SelectItem>
          <SelectSeparator />
          <SelectItem value="retired">Retired</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
