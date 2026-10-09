# Slot Pin Wiring, Plan A: Backend and Admin UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A superadmin can assign motor GPIOs to slots in the layout editor and publish that wiring as a versioned machine configuration that the device can fetch.

**Architecture:** `Pin` rows hang off `Slot` with a denormalised `machineId` so `@@unique([machineId, number])` enforces "one GPIO drives one motor per machine" in the database. Pins are saved with the layout in the existing `saveSlotLayout` transaction. A separate publish endpoint builds the payload the firmware already knows how to parse, writes a versioned `MachineConfiguration`, and announces it on the MQTT commands channel.

**Tech Stack:** TypeScript, Express, Prisma (pinned 7.10.0), Zod v4, Vitest, Next.js App Router, TanStack Form, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-22-slot-pin-wiring-design.md`

## Global Constraints

- **Do not run `git commit`.** The user commits their own work. Every task ends by running the test suite and stopping for review. Never use `git commit`, `git push`, or `--amend`.
- **Code and comments in English.** Chat with the user in Danish.
- Slot numbers are **1-based** everywhere after Task 1. Any `+ 1` or `- 1` applied to a slot number outside the Task 1 migration is a bug.
- GPIO range is **0–33** inclusive. GPIO 34–39 are input-only on the ESP32 and cannot drive a motor.
- **At most 6 pins per slot.** One `WIRING_SLOT` UART frame holds `slot` u8 + `pin_count` u8 + 6 pin bytes = the 8-byte payload ceiling.
- Superadmin-only routes use `requireSuperAdmin`, **not** a `PERMISSIONS` entry. This corrects the spec, which proposed a `CONFIGURATION_PUBLISH` permission; the codebase guards `save-slot-layout` with `requireSuperAdmin` and the publish endpoint follows it.
- Backend tests: `cd backend && npm test`. A single file: `cd backend && npx vitest run src/path/to/file.test.ts`.
- Prisma migrations are hand-written SQL in `backend/prisma/migrations/<UTC timestamp>_<snake_name>/migration.sql`, opening with a comment explaining *why*. Follow `20260922150100_backfill_machine_status_never_seen` as the model.

## File Structure

| File | Responsibility |
|---|---|
| `backend/prisma/schema.prisma` | `Pin` model, `Slot.pins` relation |
| `backend/prisma/migrations/20260923090000_slots_one_based/migration.sql` | Shift existing slot numbers to 1-based |
| `backend/prisma/migrations/20260923090100_add_slot_pins/migration.sql` | `Pin` columns, FK, constraints |
| `shared/schemas/machines.ts` | Pin shape, GPIO bounds, layout-wide pin uniqueness, `slotNumber >= 1` |
| `shared/types/machine.ts` | `SaveSlotLayoutData` gains `pins` |
| `backend/src/api/services/machines.service.ts` | Pin persistence inside the layout transaction |
| `backend/src/api/services/configuration-payload.ts` | **New.** Pure payload builder — no Prisma, no I/O |
| `backend/src/api/services/configuration.service.ts` | **New.** Publish: validate, version, write, announce |
| `backend/src/api/controllers/configuration.controller.ts` | **New.** HTTP mapping for publish |
| `backend/src/mqtt/commands.ts` | **New.** Publish a command; redeliver open commands on connect |
| `admin-frontend/.../slot-grid-editor/components/slot-inspector.tsx` | **New.** Properties panel for the selected slot |
| `admin-frontend/.../create-machine/components/publish-panel.tsx` | **New.** Publish action, version history, rollback |

`configuration-payload.ts` is split from `configuration.service.ts` deliberately: the payload shape is the contract with the firmware, and a pure function over plain rows can be tested exhaustively without mocking Prisma.

---

### Task 1: Slot numbers become 1-based

Fixes an existing bug: `device.service.ts` matches a cash sale with `slotNumber: cash.slot`, comparing the device's 1-based number against a 0-based column, so a sale from physical slot 1 is recorded against the layout's second slot.

**Files:**
- Modify: `shared/schemas/machines.ts` (the `slotLayoutSlotSchema` `slotNumber` line)
- Modify: `admin-frontend/app/(protected)/(superadmin)/create-machine/components/slot-grid-editor/layout-math.ts:115-119`
- Create: `backend/prisma/migrations/20260923090000_slots_one_based/migration.sql`
- Test: `backend/src/api/__tests__/machines-schemas.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `slotLayoutSlotSchema` rejects `slotNumber: 0`; `nextSlotNumber(slots: EditorSlot[]): number` returns `1` for an empty layout

- [ ] **Step 1: Write the failing test**

Append to `backend/src/api/__tests__/machines-schemas.test.ts` (create the file with this content if it does not exist):

```ts
import { saveSlotLayoutSchema } from "@vmaas/shared/schemas";
import { describe, expect, it } from "vitest";

const MACHINE_ID = "33333333-3333-4333-8333-333333333333";

/** One valid 1x1 slot at the origin, so each test varies only what it is about. */
function slot(overrides: Record<string, unknown> = {}) {
  return { slotNumber: 1, beginX: 0, endX: 0, beginY: 0, endY: 0, capacity: 10, ...overrides };
}

function layout(slots: unknown[], columns = 4, rows = 4) {
  return saveSlotLayoutSchema.safeParse({ body: { machineId: MACHINE_ID, columns, rows, slots } });
}

describe("saveSlotLayoutSchema — slot numbering", () => {
  // The device is 1-based (prices.h: "Slots are 1-based") and device.service.ts
  // matches a cash sale straight against this column, so a 0 here would be a slot
  // the machine can never name.
  it("rejects slot number 0", () => {
    expect(layout([slot({ slotNumber: 0 })]).success).toBe(false);
  });

  it("accepts slot number 1", () => {
    expect(layout([slot({ slotNumber: 1 })]).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/api/__tests__/machines-schemas.test.ts`
Expected: FAIL — "rejects slot number 0" gets `true`, because the schema still allows `.min(0)`.

- [ ] **Step 3: Make the schema 1-based**

In `shared/schemas/machines.ts`, inside `slotLayoutSlotSchema`, change:

```ts
    slotNumber: z.number().int().min(0),
```

to:

```ts
    // 1-based, matching the device: prices.h states "Slots are 1-based" and
    // prices.cpp discards slot 0. device.service.ts matches a cash sale straight
    // against this column, so the two numbering schemes must be the same one.
    slotNumber: z.number().int().min(1),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/api/__tests__/machines-schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Make the editor start at 1**

In `layout-math.ts`, change `nextSlotNumber`:

```ts
export function nextSlotNumber(slots: EditorSlot[]) {
  return slots.length
    ? Math.max(...slots.map((slot) => slot.slotNumber)) + 1
    : 1
}
```

Only the fallback changes from `0` to `1`.

- [ ] **Step 6: Write the migration**

Create `backend/prisma/migrations/20260923090000_slots_one_based/migration.sql`:

```sql
-- Slot numbers become 1-based, matching the device. prices.h states "Slots are
-- 1-based" and prices.cpp discards slot 0, while this column started at 0 --
-- so device.service.ts, which matches a cash sale with `slotNumber: cash.slot`,
-- has been recording sales from physical slot 1 against the layout's second
-- slot. Making the column 1-based removes the mismatch rather than converting
-- around it.
--
-- Two statements, not one: `SET slot_number = slot_number + 1` is checked per
-- row against the (machineId, slotNumber) unique index and collides with the
-- row it is about to move onto. Going via negatives is the same detour
-- saveSlotLayoutService already makes for the same reason.
UPDATE "public"."slots" SET "slotNumber" = -("slotNumber" + 1);
UPDATE "public"."slots" SET "slotNumber" = -"slotNumber";
```

- [ ] **Step 7: Apply the migration and run the whole suite**

Run: `cd backend && npx prisma migrate dev` then `npm test`
Expected: the migration applies; all tests pass. If any existing test asserts a slot number of 0, update it to 1 — that is the point of this task.

- [ ] **Step 8: Stop for review**

Report which files changed and the test output. Do not commit.

---

### Task 2: The `Pin` model

**Files:**
- Modify: `backend/prisma/schema.prisma` (the existing `Pin` model at ~line 439, and `Slot`)
- Create: `backend/prisma/migrations/20260923090100_add_slot_pins/migration.sql`

**Interfaces:**
- Consumes: Task 1's 1-based slots
- Produces: Prisma model `Pin { id, machineId, slotId, number, description }` and `Slot.pins: Pin[]`

- [ ] **Step 1: Replace the unused `Pin` model**

In `backend/prisma/schema.prisma`, replace the existing stub:

```prisma
model Pin {
  id          String  @id @default(uuid()) @db.Uuid
  number      Int
  description String?

  @@map("pin")
  @@schema("public")
}
```

with:

```prisma
/// One motor GPIO. A pin physically drives one motor, so it belongs to exactly
/// one slot; a slot may have several, because two spirals are sometimes merged
/// into one wide slot.
///
/// `machineId` is denormalised from the slot purely so the unique constraint
/// below can exist: Postgres cannot enforce uniqueness across a join, and
/// "one GPIO is used once per machine" is what the firmware requires --
/// command_handler's pin_for() returns the first match, so a duplicate would
/// silently drive the wrong motor. The service sets it from the slot's own
/// machine, never from a request body.
model Pin {
  id          String  @id @default(uuid()) @db.Uuid
  machineId   String  @db.Uuid
  slotId      String  @db.Uuid
  slot        Slot    @relation(fields: [slotId], references: [id], onDelete: Cascade)
  /// GPIO number, 0-33. 34-39 are input-only and cannot drive a motor.
  number      Int
  description String?

  @@unique([machineId, number])
  @@index([slotId])
  @@map("pin")
  @@schema("public")
}
```

- [ ] **Step 2: Add the relation to `Slot`**

In the `Slot` model, replace the commented-out line:

```prisma
  // pins Pins[] - Jeg har kommenteret dette ud, da det ikke er implementeret endnu.
```

with:

```prisma
  pins Pin[]
```

- [ ] **Step 3: Write the migration**

Create `backend/prisma/migrations/20260923090100_add_slot_pins/migration.sql`:

```sql
-- The pin table has existed empty since the schema was first drawn. It becomes
-- the motor wiring: which GPIO drives which slot.
--
-- machineId is denormalised from the slot so (machineId, number) can be unique.
-- The firmware's pin_for() returns the first slot matching a GPIO, so two slots
-- claiming the same pin would silently drive the wrong motor -- a constraint the
-- database can hold, and should.
--
-- No data step: the table is empty in every environment.
ALTER TABLE "public"."pin" ADD COLUMN "machineId" UUID NOT NULL;
ALTER TABLE "public"."pin" ADD COLUMN "slotId" UUID NOT NULL;

ALTER TABLE "public"."pin"
  ADD CONSTRAINT "pin_slotId_fkey"
  FOREIGN KEY ("slotId") REFERENCES "public"."slots"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "pin_machineId_number_key" ON "public"."pin"("machineId", "number");
CREATE INDEX "pin_slotId_idx" ON "public"."pin"("slotId");
```

- [ ] **Step 4: Apply and regenerate**

Run: `cd backend && npx prisma migrate dev && npm run prisma:generate`
Expected: the migration applies and `backend/src/generated/prisma` contains a `Pin` model with `machineId` and `slotId`.

- [ ] **Step 5: Run the suite**

Run: `cd backend && npm test`
Expected: PASS. A generated-client change can break type-only assumptions elsewhere; fix any compile error before moving on.

- [ ] **Step 6: Stop for review**

---

### Task 3: Pins in the shared layout schema

**Files:**
- Modify: `shared/schemas/machines.ts` (`slotLayoutSlotSchema`, `saveSlotLayoutSchema.superRefine`)
- Modify: `shared/types/machine.ts:~90` (`SaveSlotLayoutData` slot shape)
- Test: `backend/src/api/__tests__/machines-schemas.test.ts`

**Interfaces:**
- Consumes: Task 1's `machines-schemas.test.ts` and 1-based `slotNumber`
- Produces: each layout slot carries `pins: { number: number; description?: string }[]`; `saveSlotLayoutSchema` rejects a GPIO outside 0–33, more than 6 pins on a slot, and the same GPIO on two slots

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/api/__tests__/machines-schemas.test.ts`:

```ts
describe("saveSlotLayoutSchema — pins", () => {
  it("accepts a slot with no pins, so a layout can be drawn before it is wired", () => {
    expect(layout([slot({ pins: [] })]).success).toBe(true);
  });

  it("accepts several pins on one slot, for merged slots with a motor per spiral", () => {
    expect(layout([slot({ pins: [{ number: 21 }, { number: 22 }] })]).success).toBe(true);
  });

  // 34-39 are input-only on the ESP32 and cannot drive a motor.
  it("rejects a GPIO outside 0-33", () => {
    expect(layout([slot({ pins: [{ number: 34 }] })]).success).toBe(false);
    expect(layout([slot({ pins: [{ number: -1 }] })]).success).toBe(false);
  });

  // One WIRING_SLOT frame holds slot + pin_count + 6 pin bytes.
  it("rejects more than six pins on one slot", () => {
    const pins = [18, 19, 21, 22, 23, 25, 26].map((number) => ({ number }));
    expect(layout([slot({ pins })]).success).toBe(false);
  });

  // pin_for() returns the first match, so a duplicate would drive the wrong motor.
  it("rejects the same GPIO on two different slots", () => {
    const result = layout([
      slot({ slotNumber: 1, pins: [{ number: 18 }] }),
      slot({ slotNumber: 2, beginX: 1, endX: 1, pins: [{ number: 18 }] }),
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects the same GPIO twice on one slot", () => {
    expect(layout([slot({ pins: [{ number: 18 }, { number: 18 }] })]).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/api/__tests__/machines-schemas.test.ts`
Expected: FAIL on the rejection cases — without a `pins` field, Zod strips the key and every layout parses.

- [ ] **Step 3: Add pins to the slot schema**

In `shared/schemas/machines.ts`, add above `slotLayoutSlotSchema`:

```ts
/**
 * One motor GPIO on a slot.
 *
 * 0-33 because GPIO 34-39 are input-only on the ESP32 and cannot drive a motor;
 * the same bound is in `shared/vmaas-config/src/slot_config.h`, and a value the
 * firmware refuses at boot must not be storable here.
 *
 * The description is a label for whoever traces the cabinet later ("row 2, left
 * bank"). It is stored but never sent to the device — every byte in the wiring
 * payload counts against Motorcontrol's MAX_CONFIG_BYTES.
 */
const slotPinSchema = z.object({
  number: z
    .number()
    .int()
    .min(0, { message: "a GPIO cannot be negative" })
    .max(33, { message: "GPIO 34-39 are input-only and cannot drive a motor" }),
  description: z.string().trim().max(60).optional(),
});
```

Then add to `slotLayoutSlotSchema`'s object, after `capacity`:

```ts
    // At most six: one WIRING_SLOT frame carries `slot` u8, `pin_count` u8 and
    // six pin bytes, which is the protocol's whole 8-byte payload. The wire
    // format is the real constraint, so it is stated with the other rules.
    pins: z.array(slotPinSchema).max(6, { message: "a slot can have at most six pins" }).default([]),
```

- [ ] **Step 4: Add the layout-wide uniqueness rule**

In `saveSlotLayoutSchema.superRefine`, after the existing slot-number uniqueness block, add:

```ts
      // Across the whole layout, not merely within one slot: Motorcontrol's
      // pin_for() returns the first slot matching a GPIO, so a duplicate
      // anywhere in the machine silently drives the wrong motor.
      const pinNumbers = slots.flatMap((slot) => slot.pins.map((pin) => pin.number));
      if (new Set(pinNumbers).size !== pinNumbers.length) {
        ctx.addIssue({ code: "custom", path: ["slots"], message: "a GPIO can only drive one slot" });
      }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/api/__tests__/machines-schemas.test.ts`
Expected: PASS

- [ ] **Step 6: Update the shared type**

In `shared/types/machine.ts`, add `pins` to the slot shape inside `SaveSlotLayoutData`:

```ts
    pins: { number: number; description?: string }[];
```

- [ ] **Step 7: Run the whole suite**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 8: Stop for review**

---

### Task 4: Persist pins with the layout

**Files:**
- Modify: `backend/src/api/services/machines.service.ts:240-296` (`saveSlotLayoutService`)
- Test: `backend/src/api/services/__tests__/machines-save-layout-pins.test.ts`

**Interfaces:**
- Consumes: Task 2's `Pin` model, Task 3's `pins` on the parsed body
- Produces: after `saveSlotLayoutService`, `pin` rows match the submitted layout exactly, each with `machineId` set from the machine and `slotId` from its slot

- [ ] **Step 1: Write the failing test**

Create `backend/src/api/services/__tests__/machines-save-layout-pins.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { slotFindMany, slotUpdate, slotCreateMany, slotDeleteMany, pinDeleteMany, pinCreateMany, machineFindFirst } =
  vi.hoisted(() => ({
    slotFindMany: vi.fn(),
    slotUpdate: vi.fn(),
    slotCreateMany: vi.fn(),
    slotDeleteMany: vi.fn(),
    pinDeleteMany: vi.fn(),
    pinCreateMany: vi.fn(),
    machineFindFirst: vi.fn(),
  }));

const tx = {
  slot: { findMany: slotFindMany, update: slotUpdate, createMany: slotCreateMany, deleteMany: slotDeleteMany },
  pin: { deleteMany: pinDeleteMany, createMany: pinCreateMany },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    machine: { findFirst: machineFindFirst },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

import { saveSlotLayoutService } from "@/api/services/machines.service";

const MACHINE = "33333333-3333-4333-8333-333333333333";
const SLOT_A = "11111111-1111-4111-8111-111111111111";

function body(slots: unknown[]) {
  return { machineId: MACHINE, columns: 4, rows: 4, slots } as never;
}

beforeEach(() => {
  for (const fn of [slotFindMany, slotUpdate, slotCreateMany, slotDeleteMany, pinDeleteMany, pinCreateMany]) {
    fn.mockReset();
  }
  machineFindFirst.mockReset();
  machineFindFirst.mockResolvedValue({ slots: [{ id: SLOT_A }] });
  slotFindMany.mockResolvedValue([{ id: SLOT_A, slotNumber: 1 }]);
  slotCreateMany.mockResolvedValue({ count: 0 });
});

describe("saveSlotLayoutService — pins", () => {
  const layout = [
    {
      id: SLOT_A,
      slotNumber: 1,
      beginX: 0,
      endX: 0,
      beginY: 0,
      endY: 0,
      capacity: 10,
      pins: [{ number: 21 }, { number: 22, description: "right spiral" }],
    },
  ];

  // Wholesale replacement rather than a diff: the wiring is at most 32 rows and
  // carries no identity worth preserving, and delete-then-create sidesteps the
  // unique-constraint collision that moving a GPIO between slots would cause.
  it("clears the machine's pins before writing the new ones", async () => {
    await saveSlotLayoutService(body(layout));

    expect(pinDeleteMany).toHaveBeenCalledWith({ where: { machineId: MACHINE } });
    expect(pinDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(pinCreateMany.mock.invocationCallOrder[0]);
  });

  it("takes machineId from the machine, not from anything in the body", async () => {
    await saveSlotLayoutService(body(layout));

    const { data } = pinCreateMany.mock.calls[0][0];
    expect(data).toEqual([
      { machineId: MACHINE, slotId: SLOT_A, number: 21, description: undefined },
      { machineId: MACHINE, slotId: SLOT_A, number: 22, description: "right spiral" },
    ]);
  });

  it("writes no pin rows when nothing is wired", async () => {
    await saveSlotLayoutService(body([{ ...layout[0], pins: [] }]));

    expect(pinCreateMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/api/services/__tests__/machines-save-layout-pins.test.ts`
Expected: FAIL — `pinDeleteMany` was never called.

- [ ] **Step 3: Persist pins inside the transaction**

In `saveSlotLayoutService`, inside the `prisma.$transaction` callback, the existing body strips `id` off kept slots and creates the new ones. Change the destructuring so `pins` is held back from the slot writes, and write the pin rows after the slots exist.

Replace the kept-slot update loop and the `createMany` with:

```ts
      for (const { id, pins: _keptPins, ...slot } of keptSlots) {
        await tx.slot.update({ where: { id }, data: slot });
      }

      if (newSlots.length > 0) {
        await tx.slot.createMany({
          data: newSlots.map(({ pins: _newPins, ...slot }) => ({ ...slot, machineId })),
        });
      }

      // Pins are replaced wholesale. The wiring is at most 32 rows with no
      // identity worth preserving, and delete-then-create sidesteps the same
      // mid-sweep unique-constraint collision the negative slotNumber dance
      // above exists for: moving GPIO 18 from one slot to another would
      // otherwise have both rows present at once.
      await tx.pin.deleteMany({ where: { machineId } });

      // Re-read rather than trusting the payload: a newly created slot has no id
      // until createMany has run, and the pin rows need one.
      const stored = await tx.slot.findMany({
        where: { machineId },
        select: { id: true, slotNumber: true },
      });
      const slotIdByNumber = new Map(stored.map((slot) => [slot.slotNumber, slot.id]));

      const pinRows = data.slots.flatMap((slot) =>
        slot.pins.map((pin) => ({
          machineId,
          slotId: slotIdByNumber.get(slot.slotNumber)!,
          number: pin.number,
          description: pin.description,
        })),
      );

      if (pinRows.length > 0) {
        await tx.pin.createMany({ data: pinRows });
      }

      return tx.slot.findMany({ where: { machineId }, orderBy: { slotNumber: "asc" } });
```

Note the `slot.findMany` that feeds `slotIdByNumber` is a second read; the existing final `findMany` stays as the return value.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/api/services/__tests__/machines-save-layout-pins.test.ts`
Expected: PASS

- [ ] **Step 5: Include pins when the editor loads a machine**

In `machines.service.ts`, `getMachineWithoutTenantService` includes `slots: { orderBy: { slotNumber: "asc" } }`. Change it to carry the wiring:

```ts
      include: {
        site: SITE_SELECT,
        slots: {
          orderBy: { slotNumber: "asc" },
          include: { pins: { orderBy: { number: "asc" } } },
        },
      },
```

- [ ] **Step 6: Run the whole suite**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 7: Stop for review**

---

### Task 5: The slot inspector panel

**Files:**
- Create: `admin-frontend/app/(protected)/(superadmin)/create-machine/components/slot-grid-editor/components/slot-inspector.tsx`
- Modify: `.../slot-grid-editor/types.ts` (`EditorSlot` gains `pins`)
- Modify: `.../slot-grid-editor/save-payload.ts` (carry `pins`)
- Modify: `.../slot-grid-editor/slot-grid-editor.tsx` (render the panel beside the grid)
- Modify: `admin-frontend/types/responses.ts` (`MachineWithoutTenant` slots gain `pins`)

**Interfaces:**
- Consumes: Task 3's `pins` shape, Task 4's API now returning pins
- Produces: `<SlotInspector slot={EditorSlot | null} onChange={(slot: EditorSlot) => void} usedPins={Set<number>} />`

- [ ] **Step 1: Add pins to the editor's slot type**

In `types.ts`, add to `EditorSlot`:

```ts
  /** Motor GPIOs driving this slot. Several when two spirals are merged into one slot. */
  pins: { number: number; description?: string }[]
```

- [ ] **Step 2: Carry pins in the save payload**

In `save-payload.ts`, add `pins: slot.pins,` to the mapped object, after `capacity`.

- [ ] **Step 3: Default new slots to no pins**

In `hooks/use-slot-dragging.ts:105`, where a new slot is built with `slotNumber: nextSlotNumber(slots)`, add `pins: [],` beside it. A slot is drawn before it is wired.

- [ ] **Step 4: Write the inspector**

Create `slot-inspector.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import type { EditorSlot } from "../types"

/** GPIO 34-39 are input-only on the ESP32 and cannot drive a motor. */
const MAX_GPIO = 33
/** One WIRING_SLOT UART frame holds slot + pin_count + six pin bytes. */
const MAX_PINS = 6

interface SlotInspectorProps {
  slot: EditorSlot | null
  /** Every GPIO already used elsewhere in this machine; a pin drives one motor. */
  usedPins: Set<number>
  onChange: (slot: EditorSlot) => void
}

export function SlotInspector({ slot, usedPins, onChange }: SlotInspectorProps) {
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)

  if (!slot) {
    return (
      <aside className="w-64 rounded-lg border p-3 text-sm text-muted-foreground">
        Select a slot to set its motor pins.
      </aside>
    )
  }

  function addPin() {
    if (!slot) return

    const number = Number(draft)

    if (draft.trim() === "" || !Number.isInteger(number)) {
      setError("Enter a GPIO number")
      return
    }
    if (number < 0 || number > MAX_GPIO) {
      setError(`GPIO must be 0-${MAX_GPIO}; 34-39 are input-only`)
      return
    }
    if (usedPins.has(number)) {
      setError("That GPIO already drives another slot")
      return
    }
    if (slot.pins.length >= MAX_PINS) {
      setError(`A slot can have at most ${MAX_PINS} pins`)
      return
    }

    setError(null)
    setDraft("")
    onChange({ ...slot, pins: [...slot.pins, { number }] })
  }

  function removePin(number: number) {
    if (!slot) return
    onChange({ ...slot, pins: slot.pins.filter((pin) => pin.number !== number) })
  }

  return (
    <aside className="w-64 space-y-3 rounded-lg border p-3">
      <h2 className="text-sm font-semibold">Slot #{slot.slotNumber}</h2>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Motor pins</p>
        {slot.pins.length === 0 && (
          <p className="text-xs text-destructive">
            Not wired. The machine cannot be published until every slot has a pin.
          </p>
        )}
        <ul className="space-y-1">
          {slot.pins.map((pin) => (
            <li key={pin.number} className="flex items-center justify-between text-sm">
              <span>GPIO {pin.number}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove GPIO ${pin.number}`}
                onClick={() => removePin(pin.number)}
              >
                <X className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addPin()
            }
          }}
          inputMode="numeric"
          placeholder="GPIO"
          aria-label="GPIO number"
        />
        <Button type="button" variant="outline" size="icon" aria-label="Add pin" onClick={addPin}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </aside>
  )
}
```

- [ ] **Step 5: Render it beside the grid**

In `slot-grid-editor.tsx`, wrap the existing `<div className="max-w-full overflow-x-auto p-1">` block and the inspector in a flex row, and add above the return:

```tsx
  const usedPins = new Set(
    slots
      .filter((slot) => slot.key !== selectedKey)
      .flatMap((slot) => slot.pins.map((pin) => pin.number))
  )

  function updateSelected(next: EditorSlot) {
    history.update({
      slots: slots.map((slot) => (slot.key === next.key ? next : slot)),
    })
  }
```

Then place `<SlotInspector slot={selectedSlot} usedPins={usedPins} onChange={updateSelected} />` next to the grid. Going through `history.update` means a pin change is undoable like every other edit.

- [ ] **Step 6: Add pins to the response type**

In `admin-frontend/types/responses.ts`, add `pins: { number: number; description?: string }[]` to the slot shape inside `MachineWithoutTenant`. The `[id]/page.tsx` loader spreads each slot into `EditorSlot`, so no change is needed there.

- [ ] **Step 7: Verify the build and the page**

Run: `cd admin-frontend && npm run build`
Expected: the build succeeds. Then open `http://localhost/create-machine/<id>`, select a slot, add GPIO 18, save, reload, and confirm the pin is still there.

- [ ] **Step 8: Stop for review**

---

### Task 6: The configuration payload builder

A pure function, split out from the service so the contract with the firmware can be tested exhaustively without mocking Prisma.

**Files:**
- Create: `backend/src/api/services/configuration-payload.ts`
- Test: `backend/src/api/services/__tests__/configuration-payload.test.ts`

**Interfaces:**
- Consumes: nothing at runtime — plain rows are passed in
- Produces:
  - `type WiringSlot = { slot: number; pins: number[] }`
  - `type ConfigurationPayload = { cash: Record<string, unknown>; prices: { slot: number; priceMinor: number }[]; wiring: { version: 2; slots: WiringSlot[] } }`
  - `type PayloadSlot = { slotNumber: number; price: number | null; product: { price: number } | null; pins: { number: number }[] }`
  - `buildConfigurationPayload(slots: PayloadSlot[], cash: Record<string, unknown>): ConfigurationPayload`
  - `findUnwiredSlots(slots: PayloadSlot[]): number[]`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/api/services/__tests__/configuration-payload.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildConfigurationPayload, findUnwiredSlots } from "@/api/services/configuration-payload";

const CASH = { activeLow: true, currency: "DKK" };

function slot(overrides: Record<string, unknown> = {}) {
  return { slotNumber: 1, price: null, product: null, pins: [{ number: 18 }], ...overrides } as never;
}

describe("buildConfigurationPayload", () => {
  // The firmware's slot_config_parser reads this shape; prices.cpp reads the rest.
  it("shapes wiring as Motorcontrol's own config.json, at schema version 2", () => {
    const payload = buildConfigurationPayload(
      [slot({ slotNumber: 3, pins: [{ number: 21 }, { number: 22 }] })],
      CASH,
    );

    expect(payload.wiring).toEqual({ version: 2, slots: [{ slot: 3, pins: [21, 22] }] });
  });

  // Making the column 1-based was the whole point; a conversion here would be a bug.
  it("passes slot numbers through untouched", () => {
    const payload = buildConfigurationPayload([slot({ slotNumber: 7 })], CASH);

    expect(payload.wiring.slots[0].slot).toBe(7);
    expect(payload.prices[0].slot).toBe(7);
  });

  it("prefers the slot's price override over the product's", () => {
    const payload = buildConfigurationPayload([slot({ price: 12.5, product: { price: 15 } })], CASH);

    expect(payload.prices[0].priceMinor).toBe(1250);
  });

  it("falls back to the product's price when the slot does not override it", () => {
    const payload = buildConfigurationPayload([slot({ price: null, product: { price: 15 } })], CASH);

    expect(payload.prices[0].priceMinor).toBe(1500);
  });

  // prices.h: "0 means no price, not for sale".
  it("omits a slot with no price at all rather than pricing it at zero", () => {
    const payload = buildConfigurationPayload([slot({ price: null, product: null })], CASH);

    expect(payload.prices).toEqual([]);
  });

  it("orders wiring by slot number, so a diff between versions is readable", () => {
    const payload = buildConfigurationPayload(
      [slot({ slotNumber: 3, pins: [{ number: 21 }] }), slot({ slotNumber: 1, pins: [{ number: 18 }] })],
      CASH,
    );

    expect(payload.wiring.slots.map((entry) => entry.slot)).toEqual([1, 3]);
  });
});

describe("findUnwiredSlots", () => {
  it("names the slots with no pins", () => {
    expect(findUnwiredSlots([slot({ slotNumber: 2, pins: [] }), slot({ slotNumber: 1 })])).toEqual([2]);
  });

  it("returns nothing when every slot is wired", () => {
    expect(findUnwiredSlots([slot()])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/api/services/__tests__/configuration-payload.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the builder**

Create `backend/src/api/services/configuration-payload.ts`:

```ts
/**
 * Builds the JSON a machine fetches from `GET /api/device/configuration`.
 *
 * The shape is not ours to choose: `Main-Controller/src/prices.cpp` already
 * parses it out of `/storage/prices.json`, which its own header describes as
 * "a cache of MachineConfiguration.payload". `wiring` is shaped as
 * Motorcontrol's own config.json so Main-Controller forwards it without
 * translating between two schemas.
 *
 * Pure on purpose: the payload is the contract with two firmwares, and a
 * function over plain rows can be tested exhaustively without a database.
 */

/** Motorcontrol's slot table schema version. v1's scalar `pin` is gone. */
export const WIRING_SCHEMA_VERSION = 2;

export type PayloadSlot = {
  slotNumber: number;
  /** The slot's price override, in major units. Null falls back to the product. */
  price: number | null;
  product: { price: number } | null;
  pins: { number: number }[];
};

export type WiringSlot = { slot: number; pins: number[] };

export type ConfigurationPayload = {
  cash: Record<string, unknown>;
  prices: { slot: number; priceMinor: number }[];
  wiring: { version: number; slots: WiringSlot[] };
};

/** Major units to minor, as the firmware counts coins in minor units. */
function toMinor(major: number): number {
  return Math.round(major * 100);
}

/**
 * @returns The slot numbers with no pins. Publishing is refused while this is
 *          non-empty: a half-finished wiring must not reach hardware.
 */
export function findUnwiredSlots(slots: PayloadSlot[]): number[] {
  return slots.filter((slot) => slot.pins.length === 0).map((slot) => slot.slotNumber);
}

export function buildConfigurationPayload(slots: PayloadSlot[], cash: Record<string, unknown>): ConfigurationPayload {
  const ordered = [...slots].sort((a, b) => a.slotNumber - b.slotNumber);

  return {
    cash,
    prices: ordered.flatMap((slot) => {
      // The slot's own price wins; the product's is the fallback. A slot with
      // neither is left out entirely rather than sent as 0, which prices.h
      // defines as "no price, not for sale" — the same meaning, but stating it
      // by omission keeps the payload smaller.
      const major = slot.price ?? slot.product?.price ?? null;
      if (major === null) return [];
      return [{ slot: slot.slotNumber, priceMinor: toMinor(major) }];
    }),
    wiring: {
      version: WIRING_SCHEMA_VERSION,
      // slotNumber passes through untouched. The column is 1-based precisely so
      // no conversion is needed anywhere in the chain; a `+ 1` here is a bug.
      slots: ordered.map((slot) => ({
        slot: slot.slotNumber,
        pins: slot.pins.map((pin) => pin.number).sort((a, b) => a - b),
      })),
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/api/services/__tests__/configuration-payload.test.ts`
Expected: PASS

- [ ] **Step 5: Stop for review**

---

### Task 7: The publish endpoint

**Files:**
- Create: `backend/src/api/services/configuration.service.ts`
- Create: `backend/src/api/controllers/configuration.controller.ts`
- Modify: `backend/src/api/routes/machines.route.ts` (route above the `requireTenant` block)
- Test: `backend/src/api/services/__tests__/configuration-publish.test.ts`

**Interfaces:**
- Consumes: Task 6's `buildConfigurationPayload`, `findUnwiredSlots`
- Produces: `publishConfigurationService(machineId: string, userId: string): Promise<Result<PublishError, { version: number; commandId: string }>>` where `PublishError` is `{ reason: "MACHINE_NOT_FOUND" | "SLOTS_NOT_WIRED" | "NO_SLOTS" | "UNKNOWN_ERROR"; message: string; slots?: number[] }`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/api/services/__tests__/configuration-publish.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { machineFindFirst, configFindFirst, configCreate, commandCreate, publishCommand } = vi.hoisted(() => ({
  machineFindFirst: vi.fn(),
  configFindFirst: vi.fn(),
  configCreate: vi.fn(),
  commandCreate: vi.fn(),
  publishCommand: vi.fn(),
}));

const tx = {
  machineConfiguration: { findFirst: configFindFirst, create: configCreate },
  machineCommand: { create: commandCreate },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    machine: { findFirst: machineFindFirst },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

vi.mock("@/mqtt/commands", () => ({ publishCommand }));

import { publishConfigurationService } from "@/api/services/configuration.service";

const MACHINE = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

function machine(slots: unknown[]) {
  return {
    id: MACHINE,
    tenantId: "11111111-1111-4111-8111-111111111111",
    siteId: "22222222-2222-4222-8222-222222222222",
    slots,
  };
}

const wiredSlot = { slotNumber: 1, price: 15, product: null, pins: [{ number: 18 }] };

beforeEach(() => {
  for (const fn of [machineFindFirst, configFindFirst, configCreate, commandCreate, publishCommand]) fn.mockReset();
  configFindFirst.mockResolvedValue({ version: 3 });
  configCreate.mockImplementation(async (args: { data: { version: number } }) => ({ version: args.data.version }));
  commandCreate.mockImplementation(async (args: { data: { commandId: string } }) => args.data);
});

describe("publishConfigurationService", () => {
  it("refuses to publish while a slot has no pins, and names it", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot, { ...wiredSlot, slotNumber: 2, pins: [] }]));

    const [error] = await publishConfigurationService(MACHINE, USER);

    expect(error?.reason).toBe("SLOTS_NOT_WIRED");
    expect(error?.slots).toEqual([2]);
    expect(configCreate).not.toHaveBeenCalled();
  });

  it("refuses a machine with no slots at all", async () => {
    machineFindFirst.mockResolvedValue(machine([]));

    const [error] = await publishConfigurationService(MACHINE, USER);

    expect(error?.reason).toBe("NO_SLOTS");
  });

  it("answers MACHINE_NOT_FOUND rather than throwing", async () => {
    machineFindFirst.mockResolvedValue(null);

    const [error] = await publishConfigurationService(MACHINE, USER);

    expect(error?.reason).toBe("MACHINE_NOT_FOUND");
  });

  it("writes the next version and attributes it", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));

    const [error, result] = await publishConfigurationService(MACHINE, USER);

    expect(error).toBeNull();
    expect(result?.version).toBe(4);
    expect(configCreate.mock.calls[0][0].data.createdById).toBe(USER);
  });

  it("starts at version 1 for a machine that has never been published", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));
    configFindFirst.mockResolvedValue(null);

    const [, result] = await publishConfigurationService(MACHINE, USER);

    expect(result?.version).toBe(1);
  });

  // The command carries only the version, never the payload: the device always
  // fetches the latest, so a delayed QoS-1 delivery cannot write an older wiring
  // over a newer one.
  it("announces the version, not the payload", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));

    await publishConfigurationService(MACHINE, USER);

    const [, payload] = publishCommand.mock.calls[0];
    expect(payload).toEqual({ type: "apply_configuration", version: 4 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/api/services/__tests__/configuration-publish.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the service**

Create `backend/src/api/services/configuration.service.ts`:

```ts
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { publishCommand } from "@/mqtt/commands";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";

import { buildConfigurationPayload, findUnwiredSlots } from "./configuration-payload";

/** How long a machine has to apply a configuration before the command lapses. */
const COMMAND_TTL_MS = 24 * 60 * 60 * 1000;

export type PublishError = {
  reason: "MACHINE_NOT_FOUND" | "NO_SLOTS" | "SLOTS_NOT_WIRED" | "UNKNOWN_ERROR";
  message: string;
  /** The offending slot numbers, for SLOTS_NOT_WIRED. */
  slots?: number[];
};

/**
 * Publishes a machine's current slots, prices and wiring as the next
 * configuration version, and tells the machine to come and get it.
 *
 * Publishing is a separate act from saving the layout on purpose: a wrong pin
 * dispenses the wrong product to someone who has already paid, so the wiring
 * gets a review step, and the version history stays one row per deliberate
 * change rather than one per mouse click.
 */
export async function publishConfigurationService(
  machineId: string,
  userId: string,
): Promise<Result<PublishError, { version: number; commandId: string }>> {
  try {
    const machine = (await prisma.machine.findFirst({
      where: { id: machineId },
      select: {
        id: true,
        tenantId: true,
        siteId: true,
        slots: {
          orderBy: { slotNumber: "asc" },
          select: {
            slotNumber: true,
            price: true,
            product: { select: { price: true } },
            pins: { select: { number: true } },
          },
        },
      },
    })) as {
      id: string;
      tenantId: string | null;
      siteId: string | null;
      slots: { slotNumber: number; price: unknown; product: { price: unknown } | null; pins: { number: number }[] }[];
    } | null;

    if (!machine) {
      return err({ reason: "MACHINE_NOT_FOUND", message: "No such machine." });
    }

    if (machine.slots.length === 0) {
      return err({ reason: "NO_SLOTS", message: "The machine has no slots to publish." });
    }

    // Prisma Decimal to number. The payload builder works in plain numbers so it
    // can stay free of Prisma types.
    const slots = machine.slots.map((slot) => ({
      slotNumber: slot.slotNumber,
      price: slot.price === null ? null : Number(slot.price),
      product: slot.product ? { price: Number(slot.product.price) } : null,
      pins: slot.pins,
    }));

    // The one rule Zod cannot hold: it is about rows in the database, not the
    // shape of a body. A half-finished wiring must not reach hardware.
    const unwired = findUnwiredSlots(slots);
    if (unwired.length > 0) {
      return err({
        reason: "SLOTS_NOT_WIRED",
        message: `These slots have no motor pins: ${unwired.map((n) => `#${n}`).join(", ")}`,
        slots: unwired,
      });
    }

    // An empty cash block on purpose. Authoring cash calibration is out of scope
    // for this work (see the spec's Non-goals), and prices.cpp states that every
    // field there is optional and anything missing keeps the firmware's default.
    // Sending {} is therefore "no opinion", not "wrong values".
    const payload = buildConfigurationPayload(slots, {});
    const commandId = `cfg-${randomUUID()}`;

    const version = await prisma.$transaction(async (tx) => {
      const latest = (await tx.machineConfiguration.findFirst({
        where: { machineId },
        orderBy: { version: "desc" },
        select: { version: true },
      })) as { version: number } | null;

      const next = (latest?.version ?? 0) + 1;

      await tx.machineConfiguration.create({
        data: { machineId, version: next, payload, createdById: userId },
      });

      await tx.machineCommand.create({
        data: {
          tenantId: machine.tenantId!,
          machineId,
          commandId,
          type: "apply_configuration",
          payload: { version: next },
          expiresAt: new Date(Date.now() + COMMAND_TTL_MS),
        },
      });

      return next;
    });

    // Outside the transaction: a broker that is down must not roll back a
    // configuration that is correctly stored. The command row stays open and the
    // reconnect hook delivers it later.
    await publishCommand(
      { id: machineId, tenantId: machine.tenantId!, siteId: machine.siteId! },
      { type: "apply_configuration", version },
      commandId,
    );

    return ok({ version, commandId });
  } catch (error) {
    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while publishing the configuration.",
    });
  }
}
```

`ok`, `err` and `Result` come from `@vmaas/shared/lib/error-handling`, the same import `machines.service.ts:7` uses.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/api/services/__tests__/configuration-publish.test.ts`
Expected: PASS. Task 8 creates `@/mqtt/commands`; the test mocks it, so it passes before that module exists — but the app will not compile until Task 8 is done. Complete both before running the server.

- [ ] **Step 5: Write the controller**

Create `backend/src/api/controllers/configuration.controller.ts`:

```ts
import { publishConfigurationService } from "@/api/services/configuration.service";
import { prisma } from "@/lib/prisma";

import { machineIdParamsSchema } from "@vmaas/shared/schemas";
import type { Request, Response } from "express";

export async function publishConfigurationController(req: Request, res: Response) {
  const { params } = machineIdParamsSchema.parse(req);

  // Better Auth populates req.session in requireAuth; the user is session.user,
  // as auth.ts:53 and :85 read it. There is no req.user on this codebase.
  const [error, result] = await publishConfigurationService(params.id, req.session!.user.id);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "MACHINE_NOT_FOUND":
        return res.status(404).json({ error: error.message }).end();
      case "NO_SLOTS":
      case "SLOTS_NOT_WIRED":
        // 422: the request is well-formed, the machine's state is what refuses it.
        return res.status(422).json({ error: error.message, slots: error.slots }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while publishing the configuration" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(result).end();
}
```

`machineIdParamsSchema` is already exported from `@vmaas/shared/schemas` and already used by the other `/:id` machine routes, so no new schema is needed.

- [ ] **Step 6: Add the route**

In `backend/src/api/routes/machines.route.ts`, beside the other superadmin routes and **above** `machinesRouter.use(requireAuth, requireTenant, requireSubscription)`:

```ts
// Superadmin-only, like save-slot-layout above it: wiring is not a tenant's to
// change. Guarded by requireSuperAdmin rather than a PERMISSIONS entry, which is
// the pattern every superadmin route here already follows.
machinesRouter.post(
  "/:id/publish-configuration",
  requireAuth,
  requireSuperAdmin,
  validate(machineIdParamsSchema),
  publishConfigurationController,
);
```

Import `publishConfigurationController` from `../controllers/configuration.controller`.

Note: this sits above the `requireTenant` block, so `/:id/publish-configuration` is matched before the tenant-scoped `/:id` routes. Verify a tenant-scoped `GET /:id` still works after adding it.

- [ ] **Step 7: Run the whole suite**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 8: Stop for review**

---

### Task 8: MQTT command publishing and redelivery

**Files:**
- Create: `backend/src/mqtt/commands.ts`
- Modify: `backend/src/mqtt/client.ts` (expose the publisher to `commands.ts`)
- Modify: `backend/src/api/services/connection.service.ts` (redeliver on connect)
- Test: `backend/src/mqtt/__tests__/commands.test.ts`

**Interfaces:**
- Consumes: `createPublish` in `backend/src/mqtt/client.ts:21`, `buildTopicPrefix` in `backend/src/mqtt/topics.ts`
- Produces:
  - `publishCommand(machine: { id: string; tenantId: string; siteId: string }, payload: Record<string, unknown>, commandId: string): Promise<void>`
  - `redeliverOpenCommands(machineId: string): Promise<number>` — returns how many were republished

- [ ] **Step 1: Write the failing tests**

Create `backend/src/mqtt/__tests__/commands.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { publish, commandFindMany, machineFindFirst } = vi.hoisted(() => ({
  publish: vi.fn(),
  commandFindMany: vi.fn(),
  machineFindFirst: vi.fn(),
}));

vi.mock("@/mqtt/client", () => ({ publishToBroker: publish }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    machineCommand: { findMany: commandFindMany },
    machine: { findFirst: machineFindFirst },
  },
}));

import { publishCommand, redeliverOpenCommands } from "@/mqtt/commands";

const MACHINE = { id: "33333333-3333-4333-8333-333333333333", tenantId: "11111111-1111-4111-8111-111111111111", siteId: "22222222-2222-4222-8222-222222222222" };

beforeEach(() => {
  publish.mockReset();
  commandFindMany.mockReset();
  machineFindFirst.mockReset();
});

describe("publishCommand", () => {
  it("addresses the machine's own commands topic, with the command id as the last segment", async () => {
    await publishCommand(MACHINE, { type: "apply_configuration", version: 4 }, "cfg-1");

    const [topic] = publish.mock.calls[0];
    expect(topic).toBe(`v1/${MACHINE.tenantId}/${MACHINE.siteId}/${MACHINE.id}/commands/cfg-1`);
  });

  // A broker that is down must not fail a publish whose rows are already stored;
  // the reconnect hook delivers it later.
  it("swallows a broker failure rather than throwing", async () => {
    publish.mockRejectedValue(new Error("broker down"));

    await expect(publishCommand(MACHINE, { type: "apply_configuration", version: 4 }, "cfg-1")).resolves.toBeUndefined();
  });
});

describe("redeliverOpenCommands", () => {
  it("republishes the machine's pending, unexpired commands", async () => {
    machineFindFirst.mockResolvedValue(MACHINE);
    commandFindMany.mockResolvedValue([
      { commandId: "cfg-1", type: "apply_configuration", payload: { version: 4 } },
      { commandId: "cfg-2", type: "apply_configuration", payload: { version: 5 } },
    ]);

    const count = await redeliverOpenCommands(MACHINE.id);

    expect(count).toBe(2);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("only considers pending commands that have not expired", async () => {
    machineFindFirst.mockResolvedValue(MACHINE);
    commandFindMany.mockResolvedValue([]);

    await redeliverOpenCommands(MACHINE.id);

    const { where } = commandFindMany.mock.calls[0][0];
    expect(where.status).toBe("pending");
    expect(where.expiresAt).toHaveProperty("gt");
  });

  it("does nothing for a machine that no longer resolves", async () => {
    machineFindFirst.mockResolvedValue(null);

    expect(await redeliverOpenCommands(MACHINE.id)).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/mqtt/__tests__/commands.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Expose the publisher from `client.ts`**

In `backend/src/mqtt/client.ts`, add beside `createPublish`:

```ts
/**
 * Publish through the platform's live connection.
 *
 * `createPublish` stays exported for tests to bind a fake client to; this is
 * what production code calls.
 */
export async function publishToBroker(topic: string, payload: Record<string, unknown>): Promise<void> {
  if (!client) throw new Error("mqtt: not connected");
  await createPublish(client)(topic, payload);
}
```

- [ ] **Step 4: Write the commands module**

Create `backend/src/mqtt/commands.ts`:

```ts
/**
 * Platform-to-machine commands.
 *
 * A command says only that something changed; the machine then fetches the
 * detail over HTTPS. That split is the one `topics.ts` describes, and it is what
 * makes redelivery safe: the device always fetches the *latest* configuration,
 * so a repeated or delayed QoS-1 delivery can never apply an older one.
 */
import { prisma } from "@/lib/prisma";

import { publishToBroker } from "./client";
import { buildTopicPrefix, type MachineIdentity } from "./topics";

/**
 * Send one command. Broker failures are logged, never thrown: the command row is
 * already stored, and a machine that missed the message gets it from
 * `redeliverOpenCommands` when it next connects. Throwing here would roll back a
 * configuration that is correctly published.
 */
export async function publishCommand(
  machine: MachineIdentity,
  payload: Record<string, unknown>,
  commandId: string,
): Promise<void> {
  const topic = `${buildTopicPrefix(machine)}/commands/${commandId}`;

  try {
    await publishToBroker(topic, payload);
  } catch (error) {
    console.warn(`mqtt: could not publish ${topic}, leaving it for redelivery:`, error);
  }
}

/**
 * Republish everything still open for a machine.
 *
 * Called when the broker reports the machine connected. This is what closes the
 * hole left by `retain: false`: a machine that was offline when a configuration
 * was published never saw the message, but the row is still pending.
 *
 * @returns How many commands were republished.
 */
export async function redeliverOpenCommands(machineId: string): Promise<number> {
  const machine = (await prisma.machine.findFirst({
    where: { id: machineId },
    select: { id: true, tenantId: true, siteId: true },
  })) as MachineIdentity | null;

  // A machine with no tenant or site has no topic to publish on.
  if (!machine?.tenantId || !machine.siteId) return 0;

  const open = (await prisma.machineCommand.findMany({
    where: { machineId, status: "pending", expiresAt: { gt: new Date() } },
    select: { commandId: true, type: true, payload: true },
    orderBy: { issuedAt: "asc" },
  })) as { commandId: string; type: string; payload: Record<string, unknown> }[];

  for (const command of open) {
    await publishCommand(machine, { type: command.type, ...command.payload }, command.commandId);
  }

  return open.length;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/mqtt/__tests__/commands.test.ts`
Expected: PASS

- [ ] **Step 6: Redeliver when a machine connects**

In `backend/src/api/services/connection.service.ts`, the transition branch reads:

```ts
    if (transitioned) {
      return ok({ applied: true });
    }
```

Change it to:

```ts
    if (transitioned) {
      // The machine is reachable again, so anything it missed while offline goes
      // out now. This is what closes the hole left by `retain: false`: a machine
      // that was down when a configuration was published never saw the message,
      // but its command row is still pending.
      //
      // Guarded on "online" — a disconnect has nothing to redeliver to. Not
      // awaited: this service answers EMQX's webhook, and holding that open for
      // a republish would slow every connect. Failures are swallowed inside
      // redeliverOpenCommands, so nothing here can reject.
      if (input.status === "online") void redeliverOpenCommands(machine.id);

      return ok({ applied: true });
    }
```

Import `redeliverOpenCommands` from `@/mqtt/commands`.

- [ ] **Step 7: Run the whole suite and start the stack**

Run: `cd backend && npm test`
Expected: PASS

Then: `npm run dev` from the repo root, and publish a configuration for a wired machine through the admin UI. Confirm a `machine_configurations` row appears with `version` 1 and a `machine_commands` row with `type = 'apply_configuration'`.

- [ ] **Step 8: Stop for review**

---

### Task 9: Version history and rollback

The spec's admin UI section calls for "the version history with the publisher and time, and a rollback control", and rollback is defined as republishing an earlier version's payload as a new version.

**Files:**
- Modify: `shared/schemas/machines.ts` (new `publishConfigurationSchema`)
- Modify: `backend/src/api/services/configuration.service.ts` (accept `fromVersion`, add a list service)
- Modify: `backend/src/api/controllers/configuration.controller.ts`
- Modify: `backend/src/api/routes/machines.route.ts`
- Test: `backend/src/api/services/__tests__/configuration-publish.test.ts` (extend)

**Interfaces:**
- Consumes: Task 7's `publishConfigurationService`
- Produces:
  - `publishConfigurationSchema` — `{ params: { id }, body: { fromVersion?: number } }`
  - `publishConfigurationService(machineId: string, userId: string, fromVersion?: number)` — same return as before
  - `listConfigurationsService(machineId: string): Promise<Result<PublishError, { version: number; createdAt: Date; createdBy: { name: string } | null }[]>>`

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/api/services/__tests__/configuration-publish.test.ts`:

```ts
describe("publishConfigurationService — rollback", () => {
  // Rollback is a forward-only operation: the old payload is written as a NEW
  // version. Nothing is mutated or deleted, so the history stays a truthful
  // record of what was on the machine and when.
  it("republishes an earlier version's payload as the next version", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));
    const oldPayload = { cash: {}, prices: [], wiring: { version: 2, slots: [{ slot: 1, pins: [9] }] } };
    configFindFirst.mockImplementation(async (args: { where: { version?: number } }) =>
      args.where.version === 2 ? { version: 2, payload: oldPayload } : { version: 3 },
    );

    const [error, result] = await publishConfigurationService(MACHINE, USER, 2);

    expect(error).toBeNull();
    expect(result?.version).toBe(4);
    expect(configCreate.mock.calls[0][0].data.payload).toEqual(oldPayload);
  });

  it("answers VERSION_NOT_FOUND for a version the machine never had", async () => {
    machineFindFirst.mockResolvedValue(machine([wiredSlot]));
    configFindFirst.mockImplementation(async (args: { where: { version?: number } }) =>
      args.where.version === 9 ? null : { version: 3 },
    );

    const [error] = await publishConfigurationService(MACHINE, USER, 9);

    expect(error?.reason).toBe("VERSION_NOT_FOUND");
  });

  // A rollback restores a wiring that was valid when it was published. Holding it
  // to the machine's present slots would make the control useless exactly when it
  // is needed — after a bad edit.
  it("does not re-run the unwired check when rolling back", async () => {
    machineFindFirst.mockResolvedValue(machine([{ ...wiredSlot, slotNumber: 2, pins: [] }]));
    configFindFirst.mockImplementation(async (args: { where: { version?: number } }) =>
      args.where.version === 2 ? { version: 2, payload: { cash: {}, prices: [], wiring: { version: 2, slots: [] } } } : { version: 3 },
    );

    const [error] = await publishConfigurationService(MACHINE, USER, 2);

    expect(error).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/api/services/__tests__/configuration-publish.test.ts`
Expected: FAIL — the service takes two arguments and ignores a third.

- [ ] **Step 3: Add the request schema**

In `shared/schemas/machines.ts`:

```ts
/**
 * `POST /api/machines/:id/publish-configuration`.
 *
 * `fromVersion` turns the call into a rollback: that version's stored payload is
 * written as the next version rather than the machine's current rows being
 * rebuilt. Forward-only, so the history stays a truthful record of what was on
 * the machine and when.
 */
export const publishConfigurationSchema = z.object({
  params: machineIdParamsSchema.shape.params,
  body: z
    .object({ fromVersion: z.number().int().min(1).optional() })
    .default({}),
});
```

- [ ] **Step 4: Accept `fromVersion` in the service**

Add `"VERSION_NOT_FOUND"` to `PublishError["reason"]`, change the signature to `publishConfigurationService(machineId: string, userId: string, fromVersion?: number)`, and replace the payload construction with:

```ts
    let payload: unknown;

    if (fromVersion === undefined) {
      // The one rule Zod cannot hold: it is about rows in the database, not the
      // shape of a body. A half-finished wiring must not reach hardware.
      const unwired = findUnwiredSlots(slots);
      if (unwired.length > 0) {
        return err({
          reason: "SLOTS_NOT_WIRED",
          message: `These slots have no motor pins: ${unwired.map((n) => `#${n}`).join(", ")}`,
          slots: unwired,
        });
      }

      payload = buildConfigurationPayload(slots, {});
    } else {
      const previous = (await prisma.machineConfiguration.findFirst({
        where: { machineId, version: fromVersion },
        select: { payload: true },
      })) as { payload: unknown } | null;

      if (!previous) {
        return err({ reason: "VERSION_NOT_FOUND", message: `This machine has no version ${fromVersion}.` });
      }

      // Deliberately not re-checked against the machine's present slots: a
      // rollback restores a wiring that was valid when it was published, and
      // holding it to the current rows would disable the control exactly when it
      // is needed — right after a bad edit.
      payload = previous.payload;
    }
```

Move the `NO_SLOTS` guard so it only applies when `fromVersion` is undefined, for the same reason.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/api/services/__tests__/configuration-publish.test.ts`
Expected: PASS

- [ ] **Step 6: Add the list service**

In `configuration.service.ts`:

```ts
/** The published history of one machine, newest first, for the rollback control. */
export async function listConfigurationsService(
  machineId: string,
): Promise<Result<PublishError, { version: number; createdAt: Date; createdBy: { name: string } | null }[]>> {
  try {
    const rows = (await prisma.machineConfiguration.findMany({
      where: { machineId },
      orderBy: { version: "desc" },
      // The payload is deliberately absent: the list is a chooser, and a page of
      // full payloads would be kilobytes of JSON nobody reads.
      select: { version: true, createdAt: true, createdById: true },
    })) as { version: number; createdAt: Date; createdById: string | null }[];

    const userIds = [...new Set(rows.flatMap((row) => (row.createdById ? [row.createdById] : [])))];
    const users = (await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    })) as { id: string; name: string }[];
    const nameById = new Map(users.map((user) => [user.id, user.name]));

    return ok(
      rows.map((row) => ({
        version: row.version,
        createdAt: row.createdAt,
        createdBy: row.createdById ? { name: nameById.get(row.createdById) ?? "Unknown" } : null,
      })),
    );
  } catch (error) {
    return err({
      reason: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error while listing configurations.",
    });
  }
}
```

`User.name` is a non-nullable `String` in the schema, so the only null case is `createdById` itself being null — a configuration published by something other than a signed-in user. That is what the `createdBy: null` branch is for.

- [ ] **Step 7: Wire the controller and routes**

Add `listConfigurationsController` to `configuration.controller.ts`, mapping `UNKNOWN_ERROR` to 500 and otherwise returning 200 with the array. Change `publishConfigurationController` to parse with `publishConfigurationSchema` and pass `body.fromVersion` through. Add `VERSION_NOT_FOUND` to its switch as a 404.

In `machines.route.ts`, beside the publish route:

```ts
machinesRouter.get(
  "/:id/configurations",
  requireAuth,
  requireSuperAdmin,
  validate(machineIdParamsSchema),
  listConfigurationsController,
);
```

and change the publish route's `validate(machineIdParamsSchema)` to `validate(publishConfigurationSchema)`.

- [ ] **Step 8: Run the whole suite**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 9: Stop for review**

---

### Task 10: The publish control in the editor

**Files:**
- Create: `admin-frontend/app/(protected)/(superadmin)/create-machine/components/publish-panel.tsx`
- Modify: `admin-frontend/app/(protected)/(superadmin)/create-machine/[id]/page.tsx`
- Modify: `admin-frontend/app/(protected)/(superadmin)/create-machine/messages.ts`

**Interfaces:**
- Consumes: Task 9's `POST /:id/publish-configuration` and `GET /:id/configurations`
- Produces: `<PublishPanel machineId={string} />`

- [ ] **Step 1: Add the error messages**

In `messages.ts`, beside the existing helpers:

```ts
/** Why a publish was refused. 422 is the machine's state, not the request's shape. */
export function publishErrorMessage(status: number, detail?: string): string {
  if (status === 422) return detail ?? "Every slot needs at least one motor pin before the wiring can be published."
  if (status === 404) return "The machine or that version no longer exists."
  if (status === 403) return "Only a superadmin can publish a machine configuration."
  return "The configuration could not be published. Try again."
}
```

- [ ] **Step 2: Write the panel**

Create `publish-panel.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { Loader2, Upload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { fetchData } from "@/lib/data/data-fetch"

import { publishErrorMessage } from "../messages"

interface ConfigurationVersion {
  version: number
  createdAt: string
  createdBy: { name: string } | null
}

/**
 * Publishing is a separate act from saving the layout: a wrong pin dispenses the
 * wrong product to someone who has already paid, so the wiring gets a review
 * step, and the history stays one row per deliberate change.
 */
export function PublishPanel({ machineId }: { machineId: string }) {
  const [versions, setVersions] = useState<ConfigurationVersion[]>([])
  const [busy, setBusy] = useState(false)

  async function loadVersions() {
    const [error, rows] = await fetchData<ConfigurationVersion[]>(
      `/api/machines/${machineId}/configurations`
    )
    if (!error) setVersions(rows)
  }

  useEffect(() => {
    loadVersions()
    // machineId is the whole identity of this panel
  }, [machineId])

  async function publish(fromVersion?: number) {
    setBusy(true)

    const [error, result] = await fetchData<{ version: number }>(
      `/api/machines/${machineId}/publish-configuration`,
      { method: "POST", body: fromVersion === undefined ? {} : { fromVersion } }
    )

    setBusy(false)

    if (error) {
      toast.error("The configuration was not published", {
        description: publishErrorMessage(error.status, error.message),
      })
      return
    }

    toast.success(`Published version ${result.version}`)
    loadVersions()
  }

  return (
    <section className="mt-6 space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Configuration</h2>
          <p className="text-sm text-muted-foreground">
            Saving the layout stores it. Publishing sends it to the machine.
          </p>
        </div>
        <Button onClick={() => publish()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Upload className="h-4 w-4" />}
          Publish to machine
        </Button>
      </div>

      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing published yet.</p>
      ) : (
        <ul className="divide-y text-sm">
          {versions.map((entry, index) => (
            <li key={entry.version} className="flex items-center justify-between py-2">
              <span>
                v{entry.version}
                <span className="ml-2 text-muted-foreground">
                  {entry.createdBy?.name ?? "Unknown"} ·{" "}
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </span>
              {index > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => publish(entry.version)}
                >
                  Roll back to v{entry.version}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

`index > 0` hides the control on the newest row: rolling back to what is already live would only add a duplicate version.

- [ ] **Step 3: Render it under the editor**

In `[id]/page.tsx`, below `<SlotGridEditor ... />`, add `<PublishPanel machineId={machine.id} />` and import it from `../components/publish-panel`.

- [ ] **Step 4: Verify the build**

Run: `cd admin-frontend && npm run build`
Expected: the build succeeds.

- [ ] **Step 5: Stop for review**

---

## Manual verification of Plan A

With the stack running:

1. Open `/create-machine`, create a machine, open it.
2. Draw three slots. Confirm the first is numbered **1**, not 0.
3. Select slot 1, add GPIO 18. Select slot 2, try GPIO 18 again — the inspector refuses it.
4. Give slot 2 GPIO 19 and slot 3 GPIOs 21 and 22. Save. Reload. The pins are still there.
5. Remove slot 3's pins and publish — it is refused, naming slot 3.
6. Restore them and publish. `machine_configurations` gains a row whose `payload.wiring` is `{ version: 2, slots: [{slot:1,pins:[18]}, {slot:2,pins:[19]}, {slot:3,pins:[21,22]}] }`, and the panel lists v1 with your name and the time.
7. Change slot 1's pin to GPIO 23 and publish. v2 appears; v1 is untouched.
8. Roll back to v1. A **v3** appears whose payload equals v1's — nothing is mutated or deleted.
9. Stop the EMQX container and publish again. The publish still succeeds and the rows are written; only the broker announcement is skipped.

At this point the device still ignores all of it — Plan B is what makes it act.

## What Plan B covers

Build order 5–8 from the spec: the `WIRING_*` UART commands and their native tests, Motorcontrol's schema v2, `save_config()` and multi-pin `RUN`, then Main-Controller's `device_api::get_mtls`, the command subscription and queue, the service hold, and hardware verification on the bench boards.

Plan B is written once Plan A is in hand, so the payload format is proven in practice before firmware is built on top of it.
