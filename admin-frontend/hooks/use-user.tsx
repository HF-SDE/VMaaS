"use client"

import { User } from "better-auth"
import { createContext, useContext } from "react"

const UserContext = createContext<User | undefined>(undefined)

interface UserProviderProps {
  children: React.ReactNode
  user: User
}

export function UserProvider({ children, user }: UserProviderProps) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>
}

export function useUser() {
  const user = useContext(UserContext)

  if (!user) {
    throw new Error("useUser must be used inside UserProvider")
  }

  return user
}
