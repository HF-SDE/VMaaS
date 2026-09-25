import {
  Avatar,
  AvatarFallback,
  AvatarBadge,
  AvatarGroup,
  AvatarGroupCount,
} from "admin-frontend"

export function Sizes() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Avatar size="sm">
        <AvatarFallback>JS</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>JS</AvatarFallback>
      </Avatar>
      <Avatar size="lg">
        <AvatarFallback>JS</AvatarFallback>
      </Avatar>
    </div>
  )
}

export function WithStatusBadge() {
  return (
    <Avatar>
      <AvatarFallback>JS</AvatarFallback>
      <AvatarBadge />
    </Avatar>
  )
}

export function Group() {
  return (
    <AvatarGroup>
      <Avatar>
        <AvatarFallback>JS</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>KP</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>MR</AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+4</AvatarGroupCount>
    </AvatarGroup>
  )
}
