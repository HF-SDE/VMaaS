"use client"
// alt="" because the tenant name is always rendered next to it; the explicit
// size stops the sidebar shifting when the SVG arrives.
export function FallbackAvatar({ seed }: { seed: string }) {
  return (
    <>
      <img
        className="dark:hidden"
        alt=""
        width={32}
        height={32}
        src={`https://api.dicebear.com/10.x/slice/svg?backgroundColor=F5F5FF00&bodyColor=6E56CF&seed=${seed}`}
      />
      <img
        className="hidden dark:block"
        alt=""
        width={32}
        height={32}
        src={`https://api.dicebear.com/10.x/slice/svg?backgroundColor=0F0F1A00&bodyColor=6E56CF&seed=${seed}`}
      />
    </>
  )
}
