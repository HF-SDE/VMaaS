export type Query = Record<string, string | number | boolean | undefined>

export type HttpOptions<TBody = unknown> = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  query?: Query
  body?: TBody
}

const AUTH_COOKIE = /^(?:__Secure-|__Host-)?better-auth\./
type CookieLike = { name: string; value: string }

export function getAuthCookie(cookies: CookieLike[]): string {
  return cookies
    .filter(({ name }) => AUTH_COOKIE.test(name))
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ")
}
