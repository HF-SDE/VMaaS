"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface UserAvatarProps {
  name: string;
  email: string;
  image?: string | null | undefined;
}

export function getUserInitials(name: string, email: string) {
  const trimmedName = name.trim();

  if (trimmedName.length > 0) {
    const initials = trimmedName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");

    if (initials.length > 0) {
      return initials;
    }
  }

  return email.trim().charAt(0).toUpperCase() || "?";
}

export function UserAvatar({
  data,
  size,
}: {
  data: UserAvatarProps;
  size?: "sm" | "default" | "lg";
}) {
  return (
    <div className="flex gap-4 items-center">
      <Avatar size={size || "default"} className="rounded-lg ">
        <AvatarImage src={data.image || "/avatar.png"} alt={data.name} />
        <AvatarFallback className="rounded-lg">
          {getUserInitials(data.name, data.email)}
        </AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span
          className={cn(
            "truncate font-medium",
            size === "lg" ? "text-lg font-bold" : "",
          )}
        >
          {data.name}
        </span>
        <span
          className={cn(
            "text-muted-foreground truncate text-xs",
            size === "lg" ? "text-md" : "",
          )}
        >
          {data.email}
        </span>
      </div>
    </div>
  );
}
