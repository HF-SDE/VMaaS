# Layout Editing for Claimed Machines: Design

Date: 2026-09-23
Status: Approved for planning

## Summary

A superadmin can edit the slot layout and motor wiring of a machine that a
tenant already owns, not only one still waiting to be claimed.

Today the layout editor refuses a claimed machine by construction:
`getMachineWithoutTenantService` filters `where: { id, tenantId: null }`, and its
own doc comment states that a machine with a tenant "reads as not found: its
layout is no longer edited from there". So a cabinet rebuilt in the field cannot
be re-described anywhere in the product.

The write path is already open — `saveSlotLayoutService` looks the machine up
with `findUnique({ where: { id } })` and applies no tenant filter. Only the read
path gates it.

This design opens the read path, moves the editor to a route that honestly names
what it does, refuses to delete a slot that still holds stock, and shows the
technician what has changed since the machine was last published.

## Goals

- A superadmin can draw, move, resize and delete slots, and set pins, on a
  claimed machine.
- Stock recorded against a slot cannot be destroyed by a layout change.
- The technician can see whether the saved layout differs from what was last
  published.

## Non-goals

- **Tenant self-service.** Wiring is platform hardware; the surface stays
  superadmin-only.
- **Blocking edits while a machine sells.** A technician is always physically
  present during a reconfiguration, so a human is the synchronisation point. See
  "Why there is no lockout" below.
- **Raising the device's 32-slot ceiling.** It stays at 32, which the hardware
  the product ships on today supports. Future boards are expected to carry more
  pins, so the ceiling is a property of the board, not a constant of the
  domain — this design names it accordingly but does not make it configurable.
- **Changing how the dev seed creates slot numbers above the ceiling.** Real,
  and out of scope; this design only makes the condition visible.
- **Reporting which configuration a device is actually running.** That needs the
  device-side fetch, which belongs to the firmware plan.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Scope of editing | Full layout — slots and pins | The user's requirement; a rebuilt cabinet changes more than its wiring. |
| Deleting a slot with stock | Refused, naming the slots | The operator empties the cabinet physically anyway; nothing can be lost by accident. |
| Orphaned movement history | Accepted | `InventoryMovement.slotId` is `onDelete: SetNull`, so the ledger survives without its slot link. A soft delete would touch every slot query in the codebase. |
| Divergence between backend and device | Shown, never blocked | The backend cannot know better — see below. |
| Who may edit | Superadmin only | Consistent with every other wiring surface, which uses `requireSuperAdmin` rather than a `PERMISSIONS` entry. |
| Route | Moved to `/machine-layout/[id]` | Neither `create-machine` nor `machines` honestly names a surface that edits cabinet physics. |
| Slot numbers above 32 | Marked in the editor, not rejected | Existing machines already have them; rejecting would lock the user out of the data they need to fix. |

## Why there is no lockout

Three findings, each verified against the running code, rule out the obvious
guards.

**`disabledAt` does not stop a machine selling.** It stops the backend accepting
anything *from* the machine: `resolveMachineCertificate`
(`backend/src/api/middleware/require-machine.ts:70`) returns null for a disabled
machine, `requireMachine` answers 401, and `deviceRouter.use(requireMachine)`
guards `/configuration`, `/events`, `/events/batch`, `/command-results` and
`/certificate/renew`. The MQTT ACL uses the same resolver.

But the coin acceptor and the motor are local, deliberately: `prices.h` states
that "a coin cannot be rolled back, so payment must never wait on the network".
A disabled machine keeps selling and journals to its outbox, and the firmware
treats 401 as a credential problem rather than a queue problem
(`Main-Controller/src/device_api.cpp:238` — "keeping the line and retrying").

So disabling a machine does not close the window; it accumulates it. Every sale
made during the rebuild arrives *after* re-enabling, and is matched against the
new layout. `disabledAt` is an authorization state, not an operational one.

**A sale cannot be dated reliably.** `occurredAt` is optional in
`deviceEventBody` (`shared/schemas/device.ts`), because an ESP32 has no
battery-backed RTC and a cold boot with no network cannot date its own sales;
`uptimeMs` is the fallback and the server dates from receipt. So a drained sale
cannot be sorted before or after a layout change.

**A sale carries no configuration version.** `cashSalePayloadSchema` has `slot`,
`price_minor`, `received_minor`, `status`, `reason`, `currency` — nothing that
ties it to the layout it was made under. Fixing the misattribution at the root
needs the device to report its configuration version, which is firmware work.

Given all three, and given that a technician is always on site, the design shows
the divergence and leaves the judgement to the person standing at the machine.

## Surface

`(superadmin)/create-machine/[id]/` moves to `(superadmin)/machine-layout/[id]/`,
taking the editor components with it:

```
(superadmin)/
  create-machine/            machines awaiting a tenant, and the create dialog
    page.tsx
    create-machine-dialog.tsx
    messages.ts              stays — the dialog uses createMachineErrorMessage
  machine-layout/            new
    [id]/page.tsx
    [id]/not-found.tsx
    messages.ts              new — the editor's four helpers move here
    components/
      slot-grid-editor/
      publish-panel.tsx
```

The editor's message helpers (`machineLoadErrorMessage`,
`saveLayoutErrorMessage`, `publishErrorMessage`,
`configurationHistoryErrorMessage`) move to a `messages.ts` under
`machine-layout/`. `createMachineErrorMessage` stays with the dialog. Sharing one
file across two routes would be the only reason they were together.

The slot-grid-editor's internal imports are all relative within its own folder,
so they move without change. Only five absolute links need updating:

| File | Link | Becomes |
|---|---|---|
| `create-machine/create-machine-dialog.tsx` | `router.push('/create-machine/${id}')` | `/machine-layout/${id}` |
| `create-machine/page.tsx` | list row `href` | `/machine-layout/${id}` |
| `machine-layout/[id]/page.tsx` | back link | see below |
| `machine-layout/[id]/not-found.tsx` | back link | `/create-machine` |
| `components/app-sidebar.tsx` | `/create-machine` | unchanged — points at the list |

**Two entry points.** The unclaimed list keeps linking to the editor as it does
today. `machines/[id]` gains a superadmin-only control that links to it for a
claimed machine.

**The back link follows the machine's state.** It is hardcoded to
`/create-machine` today, which is wrong for a machine in service. The editor
already loads the machine, so it branches on `tenantId`: a claimed machine links
back to `/machines/[id]`, an unclaimed one to `/create-machine`.

## Backend

### Opening the loader

`getMachineWithoutTenantService` becomes `getMachineForLayoutService`, and
`where: { id, tenantId: null }` becomes `where: { id }`. Its doc comment states
the opposite of the new contract and must be rewritten.

The route moves with it, joining the superadmin machine-scoped family that
already sits above the `requireTenant`/`requireSubscription` block:

```
GET  /machines/:id/layout                  (was /machines/without-tenant/:id)
POST /machines/:id/publish-configuration
GET  /machines/:id/configurations
```

`GET /machines/without-tenant` — the list — stays where it is.

### Refusing to delete a slot that holds stock

A new reason `SLOTS_NOT_EMPTY` on the layout save, answered **422** with the
offending slot numbers in the message, mirroring `SLOTS_NOT_WIRED` on publish.

Enforced inside `saveSlotLayoutService`'s existing transaction, before
`slot.deleteMany`. The service currently reads `slots: { select: { id: true } }`;
it needs `slotNumber` and `quantity` as well, to decide and to name.

The rule: a slot absent from the submitted layout **and** holding
`quantity > 0` fails the whole save. A slot with a product assigned but zero
stock is empty and may be deleted.

The server is authoritative. The editor shows the same condition inline so the
technician does not have to fail a save to discover it, but the client is a
shortcut, not the guarantee.

### Slot numbers above the device's ceiling

`cashSalePayloadSchema` accepts `slot` 1–32 and the firmware's `MAX_SLOTS` is 32,
but machines in the database already carry slot numbers up to 59. A slot above 32
cannot be in the device's table and cannot report a cash sale.

`.max(32)` must **not** be added to `slotLayoutSlotSchema`: it would make every
existing machine unsaveable, locking the user out of the data they need in order
to fix it. The editor marks such slots on the card instead, the same way it marks
an unwired slot, and the save passes.

**Name the ceiling before using it a fourth time.** 32 is currently a bare
literal in three independent places across two languages:

| Where | Form | What it bounds |
|---|---|---|
| `shared/vmaas-config/src/slot_config.h:44` | `constexpr size_t MAX_SLOTS = 32` | a **count** — `SlotEntry slots[MAX_SLOTS]` |
| `Main-Controller/src/prices.h:24` | `constexpr uint8_t MAX_SLOT = 32` | a **highest slot number** — `by_slot[MAX_SLOT + 1]` |
| `shared/schemas/device.ts:70` | `.max(32)` — unnamed | a **highest slot number** |

**The two firmware constants are not the same concept**, though both are 32. A
machine with ten slots numbered 50–59 fits `MAX_SLOTS` (ten rows of thirty-two)
and overruns `MAX_SLOT` (index 59 in an array of thirty-three). They coincide
only while slots are numbered 1…n without gaps. Anyone later tempted to unify all
three should decide first whether the firmware's two *should* be one number —
that is a firmware decision, not a backend one.

The editor needs the same number as the Zod schema, and future boards are
expected to raise it. So this design adds `DEVICE_MAX_SLOT = 32` to
`shared/types/slot.ts`, beside the existing `LOW_STOCK_RATIO` and
`LOW_STOCK_LIMIT` which establish that file as where shared, commented constants
live. `cashSalePayloadSchema` and the editor both read it.

`DEVICE_MAX_SLOT` mirrors `prices.h`'s `MAX_SLOT` — a highest slot number — not
`slot_config.h`'s count. Its comment must say so, or the next person to raise the
ceiling will change the wrong one.

That does not unify the firmware's two copies — sharing a constant across C++ and
TypeScript is a build-system problem, and inventing one here would be scope the
feature does not need. It does mean the next board raises the number in **one**
TypeScript edit instead of two silent literals, and the constant's comment names
the firmware files it must be kept in step with.

## Divergence

### Computing it

No new column. The backend builds the payload from the machine's current rows —
the same `buildConfigurationPayload` the publish path uses — and compares it to
`payload` on the latest `MachineConfiguration`.

The two blocks are compared separately, because they change for different
reasons: `prices` moves when a tenant edits a slot price in their own UI, while
`wiring` moves only here.

| State | Shown |
|---|---|
| No configuration published | Nothing has been published for this machine |
| Both match | Published v4 — no unpublished changes |
| `wiring` differs | The wiring has changed since v4 |
| `prices` differs | The prices have changed since v4 |

### Delivering it

Folded into `GET /machines/:id/configurations`, which the publish panel already
fetches and already re-fetches after a publish. The response becomes
`{ versions: [...], drift: { wiring: boolean, prices: boolean } | null }`, with
`drift` null when nothing has been published. No new route, no extra round trip.

### What the UI may claim

The wording says **"Last published: v4"**, never "the device is running v4".

The backend knows what was published, not what was received. The device does not
fetch its configuration yet and does not report what it runs — both belong to the
firmware plan. Claiming otherwise is the same defect as the publish toast that
promised a boot fetch, which the previous plan's final review caught and fixed.

## Error handling

| Failure | Behaviour |
|---|---|
| Layout save removes a slot holding stock | 422, naming the slots. Nothing written. |
| Layout save on a machine that does not exist | 404, as today. |
| Layout contains a slot number above 32 | Saved. Marked in the editor, not rejected. |
| Publish with an unwired slot | 422, as today — unchanged by this work. |
| History fetch fails | The panel already distinguishes this from an empty history. |
| A claimed machine's editor opened by a non-superadmin | The page redirects to the shared denial page; the API answers 403. See below. |

**The page guard is inherited, not written.** `(superadmin)/layout.tsx` reads the
session and redirects anyone without `isSuperAdmin` to `forbiddenPath(...)`. The
new `machine-layout/` folder gets that for free **only because it sits inside the
`(superadmin)` group** — moving it out, or creating it as a sibling of the group,
silently removes the guard while every test still passes. The API's
`requireSuperAdmin` is the real boundary; the layout guard is what stops a
non-superadmin seeing a broken page instead of a clear refusal.

## Testing

- **Service:** `saveSlotLayoutService` refuses a save that removes a slot with
  `quantity > 0` and names it; permits removing a slot with zero stock; permits a
  save that keeps the slot. Extends
  `backend/src/api/services/__tests__/machines-save-layout-pins.test.ts` or a
  sibling.
- **Service:** `getMachineForLayoutService` returns a claimed machine (the
  behaviour this whole design turns on) and still returns an unclaimed one.
- **Drift:** a pure comparison over two payloads — equal, wiring-only difference,
  prices-only difference, both, and no published version. Belongs beside
  `configuration-payload.test.ts`, which is already a pure-function test file.
- **Route:** the moved path answers, and the old one no longer resolves.
- **Frontend:** no test runner exists in this repo. Verification is
  `npx tsc --noEmit` at its pre-existing error count, plus the manual walkthrough
  below.

## Manual verification

1. Open a **claimed** machine at `/machines/[id]`; the superadmin control appears
   and opens the editor.
2. The grid loads with the machine's slots and pins.
3. Delete a slot holding stock and save — refused, naming it.
4. Empty that slot's stock, delete it again, save — accepted.
5. Change a pin, save, and see the panel report that the wiring differs from the
   last published version.
6. Publish, and see the difference clear.
7. The back link returns to `/machines/[id]`, not to the unclaimed list.
8. Open an **unclaimed** machine from `/create-machine`; everything still works
   and its back link returns to `/create-machine`.

## Risks and assumptions

- **A technician is always on site during a reconfiguration.** This is the user's
  stated operating reality and the whole reason there is no lockout. If machines
  are ever reconfigured remotely, this design is wrong and the sale
  misattribution becomes live.
- **Sales made during a rebuild are matched against the new layout.** Nothing in
  this design prevents it, and nothing can until a sale carries the configuration
  version it was made under. The technician's presence is the mitigation.
- **Deleting a slot orphans its movement history** (`slotId` set to null). The
  ledger rows survive and the sums still total, but "what was in slot 5" is no
  longer answerable from the data.
- **Slots above 32 remain creatable.** They are marked, not prevented. A machine
  wired that way will not work, and the editor says so, but nothing stops a save.
- **`DEVICE_MAX_SLOT` can drift from the firmware.** It is a TypeScript copy of a
  number that also lives in `slot_config.h` and `prices.h`, and nothing enforces
  that the three agree. Raising the ceiling for a new board means changing all
  three; the constant's comment says so, which is the only guard this design
  provides. A machine whose board supports more slots than the constant admits
  would be marked as over-ceiling when it is not.

## Build order

1. Move the route and split `messages.ts`; update the five links. No behaviour
   change — do this alone so the move is reviewable as a move. The destination
   must be inside the `(superadmin)` group, or the page loses its guard.
2. Open the loader: rename the service, drop the tenant filter, move the route,
   rewrite the doc comment.
3. The `SLOTS_NOT_EMPTY` rule in `saveSlotLayoutService`, with its tests.
4. The drift comparison and its tests; fold it into the configurations response.
5. Editor: the drift display, the stock-blocked-deletion hint, and the mark for
   slots above 32.
6. The entry point on `machines/[id]`, and the state-aware back link.
