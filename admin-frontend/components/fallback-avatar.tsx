"use client"
export function FallbackAvatar({ seed }: { seed: string }) {
  return (
    <>
      <img
        className="dark:hidden"
        src={`https://api.dicebear.com/10.x/slice/svg?backgroundColor=F5F5FF00&bodyColor=6E56CF&seed=${seed}`}
      />
      <img
        className="hidden dark:block"
        src={`https://api.dicebear.com/10.x/slice/svg?backgroundColor=0F0F1A00&bodyColor=6E56CF&seed=${seed}`}
      />
    </>
  )
}
