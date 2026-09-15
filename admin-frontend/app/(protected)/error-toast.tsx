"use client"

import { useEffect } from "react"
import { toast } from "sonner"

export function ErrorToast({ message }: { message: string }) {
  useEffect(() => {
    toast.error(message, { duration: 20_000 })
  }, [message])

  return null
}
