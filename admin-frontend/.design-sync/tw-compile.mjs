import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"

mkdirSync(".design-sync/.cache", { recursive: true })
const css = readFileSync("app/globals.css", "utf8")
const result = await postcss([tailwindcss({ base: process.cwd() })]).process(css, {
  from: "app/globals.css",
  to: ".design-sync/.cache/compiled-tailwind.css",
})
writeFileSync(".design-sync/.cache/compiled-tailwind.css", result.css)
console.log("wrote", result.css.length, "bytes")
