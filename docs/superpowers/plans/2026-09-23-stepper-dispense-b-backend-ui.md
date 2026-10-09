# Stepper Dispense, Backend and Admin UI: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A superadmin sets a machine's `stepsPerVend` in the layout editor, it is saved with the layout, and it travels in the published configuration's `wiring.motor` block exactly as Motorcontrol's schema v2 parser expects it.

**Architecture:** One integer column on `Machine` with a database CHECK, threaded through the existing save-layout transaction, the pure payload builder and the publish/list services. In the editor the value lives inside the undoable `Layout` state next to `columns`/`rows`, so it is saved, reset and dirty-tracked exactly like the grid. The Zod pin rule also learns the GPIOs the firmware now reserves (console 1/3, flash 6–11), and the slot inspector refuses them with the same wording.

**Tech Stack:** TypeScript, Express, Prisma 7.10.0 (pinned), Zod v4, Vitest, Next.js App Router, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-23-stepper-dispense-design.md`, sections "Backend and admin UI", "config.json v2", "Payload" and "Reserved pins". The firmware half is done (`2026-09-23-stepper-dispense-firmware.md`); Motorcontrol already refuses a `wiring` block without `motor.stepsPerVend`, so until this plan lands a published configuration fails safe on the device.

## Global Constraints

- **Never commit.** The project owner forbids `git commit` entirely; a deny rule enforces it. Every task ends with a **Verify** step, not a commit. Leave changes in the working tree.
- **Do not start while the concurrent plan is running.** `2026-09-23-claimed-machine-layout-editing` edits `machines.service.ts`, `configuration-payload.ts`, `configuration.service.ts`, `slot-grid-editor.tsx`, `publish-panel.tsx` and `machine-layout/messages.ts`. Before Task 1, its ledger `.superpowers/sdd/2026-09-23-claimed-machine-layout-editing/progress.md` must contain a `PLAN COMPLETE` or handover line, and no file under `backend/src`, `shared/schemas`, `shared/types` or `admin-frontend/app` may have been modified in the last 15 minutes. Every implementer re-reads a file in full before editing it; the anchors named in this plan are stable but line numbers are not.
- **`stepsPerVend` is a machine property, 1–65535, default 6400**, enforced in Zod AND by a Postgres CHECK. It is required on `saveSlotLayoutSchema`: the editor always sends it.
- **The payload's `wiring` block is Motorcontrol's `config.json` v2 verbatim:** `{ "version": 2, "motor": { "stepsPerVend": N }, "slots": [ { "slot": n, "pins": [..] } ] }`. Field names are fixed by `shared/vmaas-config/src/slot_config.h`; no other names, no extra fields, no conversion of slot numbers (they are 1-based on both sides).
- **Reserved GPIOs the backend must refuse:** 1, 3 (console UART0) and 6–11 (SPI flash). The board-specific ones (STEP 4, UART 16/17) stay a firmware check. The same list appears in Zod, in the slot inspector, and in one shared constant so they cannot drift.
- **Backend gate:** `cd backend && npm test`. Frontend gate: `cd admin-frontend && npx tsc --noEmit`, compared against a baseline captured before the first frontend edit (the host has pre-existing errors: capture, diff, add none). `npm run build` cannot pass on this host; do not try it.
- **After backend changes `docker restart backend`; after frontend changes `docker restart admin-frontend`.** `tsx watch` never fires on this Windows host. The backend container runs migrations on start.
- **Code, comments and docs in English.** Frontend files use no semicolons and double quotes, as the existing editor files do; backend files use semicolons.
- **`docs/superpowers/**` is gitignored**, so this plan and its spec are intentionally untracked.

---

## Toolchain notes (Windows host)

```bash
cd /c/Users/temp/Documents/VMaaS/backend && npm test                                  # all backend tests
cd /c/Users/temp/Documents/VMaaS/backend && npx vitest run src/api/__tests__/machines-schemas.test.ts   # one file
cd /c/Users/temp/Documents/VMaaS/backend && npx prisma generate                        # after schema.prisma changes
cd /c/Users/temp/Documents/VMaaS/admin-frontend && npx tsc --noEmit 2>&1 | sort > /c/Users/temp/AppData/Local/Temp/tsc-before.txt
cd /c/Users/temp/Documents/VMaaS/admin-frontend && npx vitest run                     # frontend unit tests
docker restart backend && docker restart admin-frontend
```

Migrations are hand-written SQL files in `backend/prisma/migrations/<timestamp>_<name>/migration.sql`; the backend container applies them on restart. `npx prisma migrate dev` also works on the host when the database is reachable, but the container restart is the path this project uses.

## File Structure

```
backend/prisma/schema.prisma                                   Machine.stepsPerVend
backend/prisma/migrations/20260923150000_machine_steps_per_vend/migration.sql   NEW
shared/lib/gpio.ts                                             NEW: RESERVED_GPIOS, isReservedGpio, STEPS_PER_VEND_* bounds
shared/schemas/machines.ts                                     stepsPerVend on the body; reserved pins refused
shared/types/machine.ts                                        SaveSlotLayoutData.stepsPerVend
backend/src/api/__tests__/machines-schemas.test.ts             + stepsPerVend and reserved-pin tests
backend/src/api/services/machines.service.ts                   saveSlotLayoutService writes the column
backend/src/api/services/__tests__/machines-save-layout-steps.test.ts   NEW
backend/src/api/services/configuration-payload.ts             wiring.motor
backend/src/api/services/configuration.service.ts             selects stepsPerVend, passes motor
backend/src/api/services/__tests__/configuration-payload.test.ts        + motor tests
backend/src/api/services/__tests__/configuration-publish.test.ts        fixtures gain stepsPerVend
backend/src/api/services/__tests__/configuration-list.test.ts           fixtures gain stepsPerVend
admin-frontend/app/(protected)/(superadmin)/machine-layout/
  components/slot-grid-editor/types.ts                         Layout.stepsPerVend
  components/slot-grid-editor/layout-math.ts                   layoutFromSlots(slots, stepsPerVend)
  components/slot-grid-editor/hooks/use-layout-history.ts      takes the initial value
  components/slot-grid-editor/save-payload.ts                  sends stepsPerVend
  components/slot-grid-editor/steps-per-vend.ts                NEW: stepsPerVendError(), pure
  components/slot-grid-editor/components/motor-settings.tsx    NEW: the "Motor" card
  components/slot-grid-editor/components/slot-inspector.tsx    reserved GPIOs refused
  components/slot-grid-editor/slot-grid-editor.tsx             renders the card, passes the value
  components/slot-grid-editor/__tests__/save-payload.test.ts   NEW
  [id]/page.tsx                                                passes machine.stepsPerVend
```

---

### Task 1: Column, shared constants, schema and types

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `Machine`)
- Create: `backend/prisma/migrations/20260923150000_machine_steps_per_vend/migration.sql`
- Create: `shared/lib/gpio.ts`
- Modify: `shared/schemas/machines.ts`
- Modify: `shared/types/machine.ts`
- Test: `backend/src/api/__tests__/machines-schemas.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Prisma: `Machine.stepsPerVend: number` (Int, default 6400) — every `Machine` row and `MachineWithoutTenant` gains it automatically.
  - `shared/lib/gpio.ts`: `export const STEPS_PER_VEND_MIN = 1; export const STEPS_PER_VEND_MAX = 65535; export const STEPS_PER_VEND_DEFAULT = 6400; export const RESERVED_GPIOS: readonly number[]; export function isReservedGpio(n: number): boolean; export const RESERVED_GPIO_MESSAGE: string`
  - `saveSlotLayoutSchema.body.stepsPerVend` (required int 1–65535); pins 1, 3, 6–11 rejected with `RESERVED_GPIO_MESSAGE`.
  - `SaveSlotLayoutData.stepsPerVend: number`.

- [ ] **Step 1: Write the failing schema tests**

In `backend/src/api/__tests__/machines-schemas.test.ts`, change the `layout()` helper so every existing test keeps passing once the field is required:

```ts
function layout(slots: unknown[], columns = 4, rows = 4, stepsPerVend: unknown = 6400) {
  return saveSlotLayoutSchema.safeParse({ body: { machineId: MACHINE, columns, rows, stepsPerVend, slots } });
}
```

Then add after the `saveSlotLayoutSchema — pins` describe block:

```ts
describe("saveSlotLayoutSchema — stepsPerVend", () => {
  // Motorcontrol's config.json v2 requires motor.stepsPerVend; a layout without
  // it would publish a wiring the device refuses at boot.
  it("requires stepsPerVend", () => {
    expect(layout([slot()], 4, 4, undefined).success).toBe(false);
  });

  it("accepts the bounds 1 and 65535", () => {
    expect(layout([slot()], 4, 4, 1).success).toBe(true);
    expect(layout([slot()], 4, 4, 65535).success).toBe(true);
  });

  // u16 on the wire (WIRING_COMMIT carries it as two bytes), and 0 pulses is not a vend.
  it("rejects 0, 65536 and fractions", () => {
    expect(layout([slot()], 4, 4, 0).success).toBe(false);
    expect(layout([slot()], 4, 4, 65536).success).toBe(false);
    expect(layout([slot()], 4, 4, 6400.5).success).toBe(false);
  });
});

describe("saveSlotLayoutSchema — reserved GPIOs", () => {
  // GPIO 6-11 are the SPI flash lines and 1/3 the console on the ESP32-WROOM.
  // Motorcontrol refuses such a table at boot; a value the firmware refuses
  // must not be storable here.
  it("rejects the flash and console pins", () => {
    for (const number of [1, 3, 6, 7, 8, 9, 10, 11]) {
      expect(layout([slot({ pins: [{ number }] })]).success).toBe(false);
    }
  });

  it("still accepts the neighbouring free pins", () => {
    for (const number of [0, 2, 5, 12, 33]) {
      expect(layout([slot({ pins: [{ number }] })]).success).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the file to verify the new tests fail**

Run: `cd /c/Users/temp/Documents/VMaaS/backend && npx vitest run src/api/__tests__/machines-schemas.test.ts`
Expected: the existing tests still pass (the helper now sends `stepsPerVend`, which the schema currently ignores as an unknown key); `requires stepsPerVend`, `rejects 0, 65536 and fractions` and `rejects the flash and console pins` FAIL.

- [ ] **Step 3: Create the shared constants**

`shared/lib/gpio.ts`:

```ts
/**
 * GPIO facts about the ESP32-WROOM Motorcontrol board that both the backend
 * and the admin UI have to agree on. Mirrors the firmware's own checks in
 * `shared/vmaas-config/src/slot_config.h` (the 0-33 output range) and
 * `Motorcontrol/src/config_store.cpp` (the reserved set), so a value the
 * device would refuse at boot is refused here first.
 */

/** GPIO 34-39 are input-only and cannot drive nENABLE. */
export const MAX_OUTPUT_GPIO = 33;

/**
 * Pins no slot may drive on any board: the console UART0 (1, 3) and the SPI
 * flash (6-11). Resetting a flash line at boot bricks the board until it is
 * reflashed. The board-specific ones (the shared STEP line and the UART to
 * Main-Controller) are only known to the firmware and are checked there.
 */
export const RESERVED_GPIOS: readonly number[] = [1, 3, 6, 7, 8, 9, 10, 11];

export function isReservedGpio(number: number): boolean {
  return RESERVED_GPIOS.includes(number);
}

export const RESERVED_GPIO_MESSAGE = "GPIO 1, 3 and 6-11 are the console and flash lines and cannot drive a motor";

/**
 * STEP pulses Motorcontrol emits per vend. Sent to the device as a u16 in
 * WIRING_COMMIT and stored in its config.json as motor.stepsPerVend, so the
 * bounds are the wire's, not a preference. 6400 is one revolution of a
 * 200-step motor at 1/32 microstepping.
 */
export const STEPS_PER_VEND_MIN = 1;
export const STEPS_PER_VEND_MAX = 65535;
export const STEPS_PER_VEND_DEFAULT = 6400;
```

- [ ] **Step 4: Extend the schema**

In `shared/schemas/machines.ts`, add the import next to the existing one:

```ts
import { isReservedGpio, MAX_OUTPUT_GPIO, RESERVED_GPIO_MESSAGE, STEPS_PER_VEND_MAX, STEPS_PER_VEND_MIN } from "../lib/gpio";
```

Replace `slotPinSchema` with:

```ts
const slotPinSchema = z.object({
  number: z
    .number()
    .int()
    .min(0, { message: "a GPIO cannot be negative" })
    .max(MAX_OUTPUT_GPIO, { message: "GPIO 34-39 are input-only and cannot drive a motor" })
    .refine((number) => !isReservedGpio(number), { message: RESERVED_GPIO_MESSAGE }),
  description: z.string().trim().max(60).optional(),
});
```

and update its doc comment's first paragraph to: `0-33 because GPIO 34-39 are input-only on the ESP32, and never 1, 3 or 6-11, which are the console and the SPI flash; the same bounds are in shared/lib/gpio.ts and in the firmware, and a value the firmware refuses at boot must not be storable here.`

In `saveSlotLayoutSchema`'s body object, add after `rows`:

```ts
      /** STEP pulses per vend for every motor on this machine; Motorcontrol's
       *  motor.stepsPerVend. Required: the device refuses a wiring without it. */
      stepsPerVend: z.number().int().min(STEPS_PER_VEND_MIN).max(STEPS_PER_VEND_MAX),
```

and extend the schema's doc comment with one sentence: `The body also carries the machine-level stepsPerVend, saved in the same transaction as the slots so layout, wiring and pulse count are always one consistent snapshot.`

- [ ] **Step 5: Extend the shared type**

In `shared/types/machine.ts`, add to `SaveSlotLayoutData` after `rows: number;`:

```ts
  /** STEP pulses per vend, 1-65535. One value for the whole machine. */
  stepsPerVend: number;
```

- [ ] **Step 6: Run the schema tests to verify they pass**

Run: `cd /c/Users/temp/Documents/VMaaS/backend && npx vitest run src/api/__tests__/machines-schemas.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 7: Add the column and the migration**

In `backend/prisma/schema.prisma`, inside `model Machine`, after `disabledReason        String?`:

```prisma
  /// STEP pulses Motorcontrol emits per vend, for every motor on this machine.
  /// Published as wiring.motor.stepsPerVend (config.json v2). 6400 is one
  /// revolution of a 200-step motor at 1/32 microstepping. 1-65535: it is a
  /// u16 on the wire (WIRING_COMMIT). Bound held by a CHECK as well as by Zod,
  /// like pin.number, because seeds bypass Zod.
  stepsPerVend          Int                         @default(6400)
```

Create `backend/prisma/migrations/20260923150000_machine_steps_per_vend/migration.sql`:

```sql
-- The motors are steppers: a vend is a fixed number of STEP pulses, set per
-- machine in the layout editor and published to the device as
-- wiring.motor.stepsPerVend (Motorcontrol config.json schema v2). 6400 is one
-- revolution of a 200-step motor at 1/32 microstepping.
--
-- 1-65535 because the firmware carries it as a u16 and 0 pulses is not a vend.
-- Held by a CHECK as well as by Zod for the same reason pin.number is: the
-- seed writes rows without going through Zod.
ALTER TABLE "public"."machines"
  ADD COLUMN "stepsPerVend" INTEGER NOT NULL DEFAULT 6400;

ALTER TABLE "public"."machines"
  ADD CONSTRAINT "machines_stepsPerVend_range"
  CHECK ("stepsPerVend" BETWEEN 1 AND 65535);
```

Run: `cd /c/Users/temp/Documents/VMaaS/backend && npx prisma generate`
Expected: the client regenerates without error; `Machine` now has `stepsPerVend: number`.

- [ ] **Step 8: Run the whole backend suite**

Run: `cd /c/Users/temp/Documents/VMaaS/backend && npm test`
Expected: PASS. (Nothing reads the column yet; the schema change only adds a required body field, and the only callers are the editor and the schema tests.)

- [ ] **Step 9: Verify**

`docker restart backend`, wait ~15 s, then `docker logs backend --tail 40` shows the migration `20260923150000_machine_steps_per_vend` applied and the server answering. `git status --short` lists the six files. Do not commit.

---

### Task 2: Save, build and publish the value

**Files:**
- Modify: `backend/src/api/services/machines.service.ts` (`saveSlotLayoutService`, inside the `$transaction`)
- Modify: `backend/src/api/services/configuration-payload.ts`
- Modify: `backend/src/api/services/configuration.service.ts` (`publishConfigurationService`, `listConfigurationsService`)
- Test: `backend/src/api/services/__tests__/machines-save-layout-steps.test.ts` (new)
- Test: `backend/src/api/services/__tests__/configuration-payload.test.ts`
- Test: `backend/src/api/services/__tests__/configuration-publish.test.ts`, `configuration-list.test.ts` (fixtures)

**Interfaces:**
- Consumes: Task 1's `SaveSlotLayoutData.stepsPerVend`, `Machine.stepsPerVend`.
- Produces:
  - `export type WiringMotor = { stepsPerVend: number };`
  - `ConfigurationPayload.wiring: { version: 2; motor: WiringMotor; slots: WiringSlot[] }`
  - `buildConfigurationPayload(slots: PayloadSlot[], cash: Record<string, unknown>, motor: WiringMotor): ConfigurationPayload`

- [ ] **Step 1: Write the failing payload tests**

In `backend/src/api/services/__tests__/configuration-payload.test.ts`, add `const MOTOR = { stepsPerVend: 6400 };` under `CASH`, change every `buildConfigurationPayload(..., CASH)` call in the file to `buildConfigurationPayload(..., CASH, MOTOR)`, and change the first test to:

```ts
  // The firmware's slot_config_parser reads this shape; prices.cpp reads the rest.
  it("shapes wiring as Motorcontrol's own config.json v2: version, motor, slots", () => {
    const payload = buildConfigurationPayload(
      [slot({ slotNumber: 3, pins: [{ number: 21 }, { number: 22 }] })],
      CASH,
      { stepsPerVend: 3200 },
    );

    expect(payload.wiring).toEqual({ version: 2, motor: { stepsPerVend: 3200 }, slots: [{ slot: 3, pins: [21, 22] }] });
  });
```

Add to the `comparePayloads` describe, after the existing `payload` helper, a second helper and one test:

```ts
  const withMotor = (stepsPerVend: number) => ({
    cash: {},
    prices: [{ slot: 1, priceMinor: 1500 }],
    wiring: { version: 2, motor: { stepsPerVend }, slots: [{ slot: 1, pins: [18] }] },
  });

  // stepsPerVend rides inside wiring, so changing it is a wiring drift: the
  // device has to be re-published before the new pulse count takes effect.
  it("reports a stepsPerVend change as wiring drift", () => {
    expect(comparePayloads(withMotor(3200) as never, withMotor(6400))).toEqual({ wiring: true, prices: false });
  });
```

- [ ] **Step 2: Write the failing service test**

Create `backend/src/api/services/__tests__/machines-save-layout-steps.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { slotFindMany, slotUpdate, slotCreateMany, slotDeleteMany, pinDeleteMany, pinCreateMany, machineUpdate, machineFindUnique } =
  vi.hoisted(() => ({
    slotFindMany: vi.fn(),
    slotUpdate: vi.fn(),
    slotCreateMany: vi.fn(),
    slotDeleteMany: vi.fn(),
    pinDeleteMany: vi.fn(),
    pinCreateMany: vi.fn(),
    machineUpdate: vi.fn(),
    machineFindUnique: vi.fn(),
  }));

const tx = {
  slot: { findMany: slotFindMany, update: slotUpdate, createMany: slotCreateMany, deleteMany: slotDeleteMany },
  pin: { deleteMany: pinDeleteMany, createMany: pinCreateMany },
  machine: { update: machineUpdate },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    machine: { findUnique: machineFindUnique },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

import { saveSlotLayoutService } from "@/api/services/machines.service";

const MACHINE = "33333333-3333-4333-8333-333333333333";
const OTHER_MACHINE = "55555555-5555-4555-8555-555555555555";
const SLOT_A = "11111111-1111-4111-8111-111111111111";

const layout = [
  { id: SLOT_A, slotNumber: 1, beginX: 0, endX: 0, beginY: 0, endY: 0, capacity: 10, pins: [{ number: 18 }] },
];

function body(stepsPerVend: number, machineId: string = MACHINE) {
  return { machineId, columns: 4, rows: 4, stepsPerVend, slots: layout } as never;
}

beforeEach(() => {
  for (const fn of [slotFindMany, slotUpdate, slotCreateMany, slotDeleteMany, pinDeleteMany, pinCreateMany, machineUpdate]) {
    fn.mockReset();
  }
  machineFindUnique.mockReset();
  machineFindUnique.mockResolvedValue({ id: MACHINE, slots: [{ id: SLOT_A, slotNumber: 1, quantity: 0 }] });
  slotFindMany.mockResolvedValue([{ id: SLOT_A, slotNumber: 1 }]);
  slotCreateMany.mockResolvedValue({ count: 0 });
});

describe("saveSlotLayoutService — stepsPerVend", () => {
  // Saved in the same transaction as slots and pins: layout, wiring and pulse
  // count are one snapshot, and a publish never sees half of a save.
  it("writes stepsPerVend on the machine inside the transaction", async () => {
    await saveSlotLayoutService(body(3200));

    expect(machineUpdate).toHaveBeenCalledWith({ where: { id: MACHINE }, data: { stepsPerVend: 3200 } });
  });

  // Same guard as the pins: the id comes from the looked-up machine, never
  // from the body, so a body naming another machine cannot retarget the write.
  it("addresses the machine that was looked up, not the body's machineId", async () => {
    await saveSlotLayoutService(body(3200, OTHER_MACHINE));

    expect(machineUpdate.mock.calls[0][0].where).toEqual({ id: MACHINE });
  });

  it("does nothing when the machine does not exist", async () => {
    machineFindUnique.mockResolvedValue(null);

    const [error] = await saveSlotLayoutService(body(3200));

    expect(error?.reason).toBe("MACHINE_NOT_FOUND");
    expect(machineUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the three test files to verify they fail**

Run: `cd /c/Users/temp/Documents/VMaaS/backend && npx vitest run src/api/services/__tests__/configuration-payload.test.ts src/api/services/__tests__/machines-save-layout-steps.test.ts`
Expected: the payload file fails to type-check or fails on the `motor` assertions; the steps file fails with `machineUpdate` never called.

- [ ] **Step 4: Extend the payload builder**

In `backend/src/api/services/configuration-payload.ts`:

Add after `WiringSlot`:

```ts
/** Motorcontrol's `motor` block: the STEP pulse count every vend on this machine emits. */
export type WiringMotor = { stepsPerVend: number };
```

Change `ConfigurationPayload.wiring` to:

```ts
  wiring: { version: typeof WIRING_SCHEMA_VERSION; motor: WiringMotor; slots: WiringSlot[] };
```

Replace the whole `buildConfigurationPayload` function with:

```ts
export function buildConfigurationPayload(
  slots: PayloadSlot[],
  cash: Record<string, unknown>,
  motor: WiringMotor,
): ConfigurationPayload {
  const ordered = [...slots].sort((a, b) => a.slotNumber - b.slotNumber);

  return {
    cash,
    prices: ordered.flatMap((slot) => {
      const major = slot.price ?? slot.product?.price ?? null;
      if (major === null) return [];
      return [{ slot: slot.slotNumber, priceMinor: toMinor(major) }];
    }),
    // Property order is part of the contract: comparePayloads compares the
    // JSON text, and Motorcontrol's parser expects exactly these keys.
    wiring: {
      version: WIRING_SCHEMA_VERSION,
      motor: { stepsPerVend: motor.stepsPerVend },
      slots: ordered.map((slot) => ({
        slot: slot.slotNumber,
        pins: slot.pins.map((pin) => pin.number).sort((a, b) => a - b),
      })),
    },
  };
}
```

Extend the file comment: `wiring.motor` carries the machine's `stepsPerVend`, which the device's parser requires; a change to it is therefore wiring drift.

- [ ] **Step 5: Thread it through the services**

In `backend/src/api/services/configuration.service.ts`:

In `publishConfigurationService`, add `stepsPerVend: true,` to the machine `select` (after `siteId: true,`), add `stepsPerVend: number;` to the cast type, and change the build call to:

```ts
        payload = buildConfigurationPayload(slots, {}, { stepsPerVend: machine.stepsPerVend });
```

In `listConfigurationsService`, add `stepsPerVend: true,` to the machine `select` and `stepsPerVend: number;` to the cast type, and change the drift computation to:

```ts
    const drift = latest
      ? comparePayloads(
          buildConfigurationPayload(toPayloadSlots(machine.slots), {}, { stepsPerVend: machine.stepsPerVend }),
          latest.payload,
        )
      : null;
```

In `backend/src/api/services/machines.service.ts`, inside `saveSlotLayoutService`'s `$transaction` callback, as the first statement (before `tx.slot.deleteMany`):

```ts
      // The pulse count belongs to the machine, not to a slot, and is saved in
      // the same transaction so a publish never sees a layout from one save and
      // a step count from another.
      await tx.machine.update({ where: { id: machineId }, data: { stepsPerVend: data.stepsPerVend } });
```

- [ ] **Step 6: Fix the publish/list test fixtures**

In `backend/src/api/services/__tests__/configuration-publish.test.ts` and `configuration-list.test.ts`, every mocked `machine.findFirst` resolution that returns a machine object gains `stepsPerVend: 6400`. Any assertion on the built payload's `wiring` gains `motor: { stepsPerVend: 6400 }` between `version` and `slots`. Read each file in full first; the exact fixture shapes were written by the concurrent plan and may differ from what this plan expects.

- [ ] **Step 7: Run the whole backend suite**

Run: `cd /c/Users/temp/Documents/VMaaS/backend && npm test`
Expected: PASS, including `machines-save-layout-steps` (3 tests), the extended payload tests and the publish/list tests. If `machines-save-layout-pins.test.ts` fails because its `tx` mock has no `machine.update`, add `machine: { update: vi.fn() }` to that file's `tx` object; its `body()` sends no `stepsPerVend`, which becomes `data: { stepsPerVend: undefined }` and is fine for a mock.

- [ ] **Step 8: Verify**

`docker restart backend`; after ~15 s, with an authenticated superadmin session, `POST /api/machines/save-slot-layout` with a body containing `stepsPerVend: 3200` answers 200, then `POST /api/machines/:id/publish-configuration` answers 200, and the newest `machine_configurations.payload` row contains `"wiring":{"version":2,"motor":{"stepsPerVend":3200},"slots":[...]}`. Check it in the Docker Postgres:

```bash
docker exec postgres psql -U admin -d vmaas -c "select version, payload->'wiring' from machine_configurations order by version desc limit 1;"
```

(or via the admin UI's publish panel after Task 3.) Do not commit.

---

### Task 3: The "Motor" card in the layout editor

`stepsPerVend` joins the undoable `Layout`, is saved with the layout, and the slot inspector refuses the reserved GPIOs with the shared wording.

**Files:**
- Modify: `admin-frontend/app/(protected)/(superadmin)/machine-layout/components/slot-grid-editor/types.ts`
- Modify: `.../slot-grid-editor/layout-math.ts` (`layoutFromSlots`)
- Modify: `.../slot-grid-editor/hooks/use-layout-history.ts`
- Modify: `.../slot-grid-editor/save-payload.ts`
- Create: `.../slot-grid-editor/steps-per-vend.ts`
- Create: `.../slot-grid-editor/components/motor-settings.tsx`
- Modify: `.../slot-grid-editor/components/slot-inspector.tsx`
- Modify: `.../slot-grid-editor/slot-grid-editor.tsx`
- Modify: `admin-frontend/app/(protected)/(superadmin)/machine-layout/[id]/page.tsx`
- Test: `.../slot-grid-editor/__tests__/save-payload.test.ts` (new)

**Interfaces:**
- Consumes: `machine.stepsPerVend` on `MachineWithoutTenant` (from Prisma via Task 1), `SaveSlotLayoutData.stepsPerVend`, `shared/lib/gpio.ts` constants.
- Produces: `Layout.stepsPerVend: number`; `layoutFromSlots(slots: EditorSlot[], stepsPerVend: number): Layout`; `useLayoutHistory(initialSlots: EditorSlot[], initialStepsPerVend: number)`; `SlotGridEditor` prop `initialStepsPerVend: number`; `MotorSettings` component; `stepsPerVendError(raw: string): string | null` exported from `steps-per-vend.ts` (pure, no React, so the unit test loads no component).

- [ ] **Step 1: Capture the tsc baseline**

Run: `cd /c/Users/temp/Documents/VMaaS/admin-frontend && npx tsc --noEmit 2>&1 | sort > /c/Users/temp/AppData/Local/Temp/tsc-before.txt; wc -l < /c/Users/temp/AppData/Local/Temp/tsc-before.txt`
Expected: a line count (pre-existing errors). Keep the file.

- [ ] **Step 2: Write the failing unit test**

Create `admin-frontend/app/(protected)/(superadmin)/machine-layout/components/slot-grid-editor/__tests__/save-payload.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { createSavePayload } from "../save-payload"
import { stepsPerVendError } from "../steps-per-vend"
import type { Layout } from "../types"

const layout: Layout = {
  columns: 2,
  rows: 1,
  stepsPerVend: 3200,
  slots: [
    { key: "a", id: "a", slotNumber: 1, beginX: 0, endX: 0, beginY: 0, endY: 0, quantity: 0, capacity: 10, pins: [{ number: 18 }] },
  ],
}

describe("createSavePayload", () => {
  // The backend requires it; a layout save without it is a 400.
  it("sends stepsPerVend beside the grid size", () => {
    const payload = createSavePayload("m1", layout)

    expect(payload.stepsPerVend).toBe(3200)
    expect(payload.columns).toBe(2)
    expect(payload.slots[0].pins).toEqual([{ number: 18 }])
  })
})

describe("stepsPerVendError", () => {
  it("accepts the bounds", () => {
    expect(stepsPerVendError("1")).toBeNull()
    expect(stepsPerVendError("65535")).toBeNull()
    expect(stepsPerVendError("6400")).toBeNull()
  })

  it("names the problem for blanks, fractions and out-of-range values", () => {
    expect(stepsPerVendError("")).toBe("Enter the number of steps")
    expect(stepsPerVendError("64.5")).toBe("Enter the number of steps")
    expect(stepsPerVendError("0")).toBe("Steps must be 1-65535")
    expect(stepsPerVendError("65536")).toBe("Steps must be 1-65535")
  })
})
```

Run: `cd /c/Users/temp/Documents/VMaaS/admin-frontend && npx vitest run app/\(protected\)/\(superadmin\)/machine-layout/components/slot-grid-editor/__tests__/save-payload.test.ts`
Expected: FAIL — `steps-per-vend` does not exist and `Layout` has no `stepsPerVend`.

- [ ] **Step 3: Put the value into the layout state**

`types.ts` — add to `Layout` after `rows: number`:

```ts
  /** STEP pulses per vend for every motor on this machine, 1-65535. Machine-level,
   *  but kept in the layout so it is saved, reset and undone with the grid. */
  stepsPerVend: number
```

`layout-math.ts` — change `layoutFromSlots`:

```ts
export function layoutFromSlots(slots: EditorSlot[], stepsPerVend: number): Layout {
  if (slots.length === 0) {
    return { slots, columns: DEFAULT_GRID_SIZE, rows: DEFAULT_GRID_SIZE, stepsPerVend }
  }

  return {
    slots,
    columns: Math.max(...slots.map((slot) => slot.endX + 1)),
    rows: Math.max(...slots.map((slot) => slot.endY + 1)),
    stepsPerVend,
  }
}
```

`hooks/use-layout-history.ts` — change the signature and the initialiser:

```ts
export function useLayoutHistory(initialSlots: EditorSlot[], initialStepsPerVend: number) {
  const [savedLayout, setSavedLayout] = useState(() =>
    layoutFromSlots(initialSlots, initialStepsPerVend)
  )
```

`save-payload.ts` — add `stepsPerVend: layout.stepsPerVend,` after `rows: layout.rows,`.

- [ ] **Step 4: Create the validator and the Motor card**

`steps-per-vend.ts` (pure, so the unit test imports no React):

```ts
import { STEPS_PER_VEND_MAX, STEPS_PER_VEND_MIN } from "@vmaas/shared/lib/gpio"

/** Why a string is rejected as a step count, or null when it is usable. The card shows the text. */
export function stepsPerVendError(raw: string): string | null {
  const trimmed = raw.trim()
  const value = Number(trimmed)
  if (trimmed === "" || !Number.isInteger(value)) return "Enter the number of steps"
  if (value < STEPS_PER_VEND_MIN || value > STEPS_PER_VEND_MAX) {
    return `Steps must be ${STEPS_PER_VEND_MIN}-${STEPS_PER_VEND_MAX}`
  }
  return null
}
```

`components/motor-settings.tsx`:

```tsx
"use client"

import { useState } from "react"

import { Input } from "@/components/ui/input"

import { stepsPerVendError } from "../steps-per-vend"

interface MotorSettingsProps {
  stepsPerVend: number
  /** Called with a valid value on blur or Enter, so typing does not create one undo step per digit. */
  onChange: (stepsPerVend: number) => void
}

/**
 * The machine-level motor setting. One value for every slot: the motors are
 * steppers on one shared STEP line, and a vend is a fixed number of pulses.
 * The pulse interval is a firmware constant, so no duration can be shown here.
 */
export function MotorSettings({ stepsPerVend, onChange }: MotorSettingsProps) {
  const [draft, setDraft] = useState(String(stepsPerVend))
  const [error, setError] = useState<string | null>(null)

  // Undo/redo/reset change the prop underneath an untouched field; follow them.
  const [seen, setSeen] = useState(stepsPerVend)
  if (seen !== stepsPerVend) {
    setSeen(stepsPerVend)
    setDraft(String(stepsPerVend))
    setError(null)
  }

  function commit() {
    const problem = stepsPerVendError(draft)
    setError(problem)
    if (problem) return
    const value = Number(draft.trim())
    if (value !== stepsPerVend) onChange(value)
  }

  return (
    <aside className="w-64 space-y-2 rounded-lg border p-3">
      <h2 className="text-sm font-semibold">Motor</h2>
      <label className="block space-y-1 text-xs text-muted-foreground">
        <span>Steps per vend</span>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            }
          }}
          inputMode="numeric"
          aria-label="Steps per vend"
          aria-invalid={error !== null}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        6400 = one full turn at 1/32 microstepping. Applies to every slot.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </aside>
  )
}
```

- [ ] **Step 5: Refuse reserved GPIOs in the inspector**

In `components/slot-inspector.tsx`, add the import:

```ts
import { isReservedGpio, RESERVED_GPIO_MESSAGE } from "@vmaas/shared/lib/gpio"
```

and in `addPin()`, immediately after the `number < 0 || number > MAX_GPIO` check, add:

```ts
    if (isReservedGpio(number)) {
      setError(RESERVED_GPIO_MESSAGE)
      return
    }
```

- [ ] **Step 6: Wire the card into the editor and the page**

In `slot-grid-editor.tsx` (re-read the file first; the concurrent plan changed it):

- Add `import { MotorSettings } from "./components/motor-settings"` beside the other component imports.
- Add `initialStepsPerVend: number` to `SlotGridEditorProps` and destructure it in the component signature.
- Change `const history = useLayoutHistory(initialSlots)` to `const history = useLayoutHistory(initialSlots, initialStepsPerVend)`.
- Wrap the existing `<SlotInspector ... />` element in a column and add the card under it:

```tsx
        <div className="space-y-3">
          <SlotInspector
            key={selectedKey ?? "none"}
            slot={selectedSlot}
            usedPins={usedPins}
            onChange={updateSelected}
          />
          <MotorSettings
            stepsPerVend={layout.stepsPerVend}
            onChange={(stepsPerVend) => history.update({ stepsPerVend })}
          />
        </div>
```

(Keep whatever extra props the concurrent plan added to `SlotInspector`; only the wrapping `div` and the `MotorSettings` element are new.)

In `[id]/page.tsx`, change the editor element to:

```tsx
      <SlotGridEditor
        machineId={machine.id}
        initialSlots={initialSlots}
        initialStepsPerVend={machine.stepsPerVend}
      />
```

(Again keep any props the concurrent plan added; only `initialStepsPerVend` is new.)

- [ ] **Step 7: Run the unit test and the type check**

Run: `cd /c/Users/temp/Documents/VMaaS/admin-frontend && npx vitest run app/\(protected\)/\(superadmin\)/machine-layout/components/slot-grid-editor/__tests__/save-payload.test.ts`
Expected: PASS, 3 tests. If vitest cannot resolve `@vmaas/shared/lib/gpio` (the frontend's own tests have never imported the shared package under vitest), add `"@vmaas/shared": path.resolve(import.meta.dirname, "../shared")` to `resolve.alias` in `admin-frontend/vitest.config.ts` and run again; `shared/lib/gpio.ts` imports nothing, so no further aliasing is needed.

Run: `cd /c/Users/temp/Documents/VMaaS/admin-frontend && npx tsc --noEmit 2>&1 | sort | diff /c/Users/temp/AppData/Local/Temp/tsc-before.txt - && echo IDENTICAL`
Expected: `IDENTICAL` (no new errors). If `@vmaas/shared/lib/gpio` cannot be resolved, check how `slot-grid-editor.tsx` imports `@vmaas/shared/lib/slot-layout` and use the same alias form.

- [ ] **Step 8: Verify in the running app**

`docker restart admin-frontend` (and `docker restart backend` if not done after Task 2). Open a machine in `/machine-layout/<id>` as a superadmin:

1. The Motor card shows `6400` for a machine that never had the value set.
2. Type `3200`, press Enter: the toolbar's Save enables (the layout is dirty). Undo restores `6400` in the field.
3. Save; reload the page: the card shows `3200`.
4. Type `0` or `70000`: the red message `Steps must be 1-65535` appears and Save stays disabled for that change.
5. In the slot inspector, adding GPIO `6` is refused with the console/flash message; GPIO `5` is accepted.
6. Publish; the publish panel's history gains a version, and the drift banner clears. Change the steps and save again without publishing: the drift banner reports wiring drift.

Record what you saw. Do not commit.

---

## Manual verification of this plan

- [ ] `cd backend && npm test` green; `cd admin-frontend && npx vitest run` green; `npx tsc --noEmit` identical to the baseline.
- [ ] A published configuration's `payload.wiring` is `{ "version": 2, "motor": { "stepsPerVend": N }, "slots": [...] }` and nothing else.
- [ ] `stepsPerVend` 0 or 65536 is refused by the API (400) and by the database (`INSERT ... 70000` fails on `machines_stepsPerVend_range`).
- [ ] GPIO 1, 3, 6–11 are refused by the API and by the inspector; GPIO 0, 2, 5, 12–33 are accepted.
- [ ] Changing `stepsPerVend` and saving shows wiring drift until the next publish.

## What Plan B covers

The device side of delivery: Main-Controller fetches the configuration over mTLS, forwards `wiring.motor.stepsPerVend` in the 3-byte `WIRING_COMMIT`, Motorcontrol's `save_config()` writes config.json v2 and reloads. Written against the wiring spec (2026-09-22) as amended by the stepper spec (2026-09-23), once this plan has landed.
