import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: { "react-hooks/set-state-in-effect": "off" } },
  // Vendored from the mapcn registry and re-added by the CLI, so a hand-fix
  // here does not survive the next `add`. The ref writes it flags are the
  // component's own latest-callback pattern, not our code.
  {
    files: ["components/ui/map.tsx"],
    rules: { "react-hooks/refs": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated design-sync output — gitignored, and not ours to lint.
    "ds-bundle/**",
  ]),
])

export default eslintConfig
