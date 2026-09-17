## Setup

No React provider is required for styling — colors, radii, and shadows come entirely from CSS custom properties on `:root`/`.dark`, already baked into the shipped `styles.css`. Fonts (Inter for `--font-sans`, JetBrains Mono for `--font-mono`) are shipped too and apply automatically via a plain `html { font-family: ... }` rule — no font-loading code needed.

**Dark mode is a class, not a provider.** Wrap a design in `<div class="dark">…</div>` (or apply `dark` to any ancestor) to switch it into the dark palette; the default (no class) is light. There is no `ThemeProvider`/context to import — this is pure CSS via `@custom-variant dark (&:is(.dark *))`.

## Styling idiom

Tailwind utility classes, with this system's semantic color tokens as the on-brand palette — prefer these over Tailwind's default color scale (`red-500` etc., which is also present in the bundle but is NOT the brand palette):

| Class | Use for |
|---|---|
| `bg-background` / `text-foreground` | page/base surface |
| `bg-card` / `text-card-foreground` | card surfaces (paired with `ring-1 ring-foreground/10`, not `border`) |
| `bg-popover` / `text-popover-foreground` | dialogs, dropdowns, selects |
| `bg-primary` / `text-primary-foreground` | primary actions |
| `bg-secondary` / `text-secondary-foreground` | secondary emphasis |
| `bg-muted` / `text-muted-foreground` | de-emphasized text/surfaces |
| `bg-destructive` / `text-destructive` | destructive actions (used at low opacity, e.g. `bg-destructive/10`, not solid) |
| `border-border` / `border-input` | borders and form-control outlines |
| `ring-ring/50` | focus rings (`focus-visible:ring-3`) |

Radii: `rounded-md` (controls), `rounded-xl` (cards/dialogs) — backed by `--radius` (0.7rem). Shadows: `shadow-xs`/`shadow-sm`/`shadow-md` map to the shipped `--shadow-*` tokens. General layout/spacing/typography uses ordinary Tailwind utilities (`flex`, `gap-2`, `text-sm`, etc.) — nothing DS-specific there.

## Where the truth lives

- `styles.css` → `@import`s `fonts/fonts.css` then `_ds_bundle.css` (the full compiled stylesheet: tokens + every utility class this build ships).
- Per-component `.prompt.md` next to each `.jsx`/`.d.ts`.

## Building with it

Compound components (Card, Select, Dialog, Avatar) ship their sub-parts as named exports even though only the root is individually documented — compose the real parts, e.g.:

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter, Button, Badge } from "admin-frontend"

<Card style={{ width: 320 }}>
  <CardHeader>
    <CardTitle>Machine VM-104</CardTitle>
    <CardDescription>Central Station, Platform 2</CardDescription>
    <CardAction><Badge variant="secondary">Online</Badge></CardAction>
  </CardHeader>
  <CardContent><p>Stock level is healthy across all slots.</p></CardContent>
  <CardFooter><Button variant="outline" size="sm">View details</Button></CardFooter>
</Card>
```
