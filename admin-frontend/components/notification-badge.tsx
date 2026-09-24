import { cn } from "@/lib/utils"
import { Badge } from "./ui/badge"

interface NotificationBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: React.ReactNode
  showZero?: boolean
  variant?: "default" | "secondary" | "destructive" | "outline"
}

export function NotificationBadge({
  children,
  value,
  showZero = false,
  variant = "default",
  className,
  ...props
}: NotificationBadgeProps) {
  // Hide badge if count is 0 and showZero is false
  const hasNotification =
    value !== undefined && value !== null && (showZero || value !== 0)

  return (
    <div className={cn("relative inline-flex w-full", className)} {...props}>
      {children}
      {hasNotification && (
        <Badge
          variant={variant}
          className="pointer-events-none absolute -top-2 -left-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold"
        >
          {value}
        </Badge>
      )}
    </div>
  )
}
