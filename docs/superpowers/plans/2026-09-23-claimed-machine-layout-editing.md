# Layout Editing for Claimed Machines — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A superadmin can edit the slot layout and motor wiring of a machine a tenant already owns, and can see what has changed since it was last published.

**Architecture:** The write path is already open — only the loader gates on `tenantId: null`. This plan opens that gate, moves the editor to a route that honestly names it, refuses to delete a slot still holding stock, and folds a payload comparison into the configuration history the publish panel already fetches.

**Tech Stack:** TypeScript, Express, Prisma (pinned 7.10.0), Zod v4, Vitest, Next.js App Router, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-23-claimed-machine-layout-editing-design.md`

## Global Constraints

- **Do not run `git commit`.** The user commits their own work. Every task ends by running the gates and stopping for review. Never use `git commit`, `git push`, `git add` or `--amend`.
- **Code and comments in English.** Chat with the user in Danish. This codebase's comment style explains **why**, not what — match it.
- Slot numbers are **1-based**. Any `+ 1`/`- 1` on a slot number is a bug.
- The editor surface is **superadmin-only**, guarded by `requireSuperAdmin` on the API and by `(superadmin)/layout.tsx` on the page. **The page guard is inherited from the route group** — anything moved out of `(superadmin)/` silently loses it while every test still passes.
- GPIO range is **0–33**; at most **6 pins per slot**.
- `DEVICE_MAX_SLOT` is 32 and mirrors `Main-Controller/src/prices.h`'s `MAX_SLOT` (a highest slot **number**), **not** `slot_config.h`'s `MAX_SLOTS` (a **count**). The two firmware constants are different concepts that happen to share a value.
- Backend gate: `cd backend && npm test`. Baseline **458 passing across 48 files**.
- Frontend gate: `cd admin-frontend && npx tsc --noEmit`. Baseline **48 pre-existing errors** — capture the list before, compare after, add none. `npm run build` cannot pass on this host (`shared/node_modules` is empty, so `zod/v4` is unresolvable from a sibling package); do not try it.
- After backend changes, `docker restart backend` — `tsx watch` never fires on this Windows host because Docker Desktop delivers no inotify events over 9p. After frontend changes, `docker restart admin-frontend`.

## File Structure

| File | Responsibility |
|---|---|
| `admin-frontend/app/(protected)/(superadmin)/machine-layout/[id]/` | **Moved.** The editor page, its not-found, and its components |
| `admin-frontend/app/(protected)/(superadmin)/machine-layout/messages.ts` | **New.** The editor's four message helpers |
| `admin-frontend/app/(protected)/(superadmin)/create-machine/messages.ts` | Keeps `createMachineErrorMessage` only |
| `shared/types/slot.ts` | Gains `DEVICE_MAX_SLOT` |
| `backend/src/api/services/machines.service.ts` | Loader opened; `SLOTS_NOT_EMPTY` rule |
| `backend/src/api/services/configuration-payload.ts` | Gains `toPayloadSlots` and `comparePayloads` — both pure |
| `backend/src/api/services/configuration.service.ts` | Uses the two new pure helpers; list returns drift |
| `admin-frontend/.../machines/[id]/machine-detail.tsx` | Superadmin entry point |

`toPayloadSlots` and `comparePayloads` go in `configuration-payload.ts` rather than the service because that file is already the Prisma-free module whose whole point is being exhaustively testable without a database. Keep it that way: `toPayloadSlots` takes plain rows, not Prisma types.

---

### Task 1: Move the editor to `/machine-layout/[id]`

A pure move plus a message split. No behaviour changes, so a reviewer can check it *as* a move.

**Files:**
- Move: `admin-frontend/app/(protected)/(superadmin)/create-machine/[id]/` → `admin-frontend/app/(protected)/(superadmin)/machine-layout/[id]/`
- Move: `admin-frontend/app/(protected)/(superadmin)/create-machine/components/` → `admin-frontend/app/(protected)/(superadmin)/machine-layout/components/`
- Create: `admin-frontend/app/(protected)/(superadmin)/machine-layout/messages.ts`
- Modify: `admin-frontend/app/(protected)/(superadmin)/create-machine/messages.ts`
- Modify: `admin-frontend/app/(protected)/(superadmin)/create-machine/create-machine-dialog.tsx`
- Modify: `admin-frontend/app/(protected)/(superadmin)/create-machine/page.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: the editor at `/machine-layout/[id]`; `machine-layout/messages.ts` exporting `machineLoadErrorMessage`, `saveLayoutErrorMessage`, `publishErrorMessage`, `configurationHistoryErrorMessage`

- [ ] **Step 1: Capture the frontend baseline**

Run: `cd C:\Users\temp\Documents\VMaaS\admin-frontend && npx tsc --noEmit 2>&1 | sort > C:\Users\temp\AppData\Local\Temp\tsc-before.txt && wc -l < C:\Users\temp\AppData\Local\Temp\tsc-before.txt`

Expected: 48. Keep this file; every later step compares against it.

- [ ] **Step 2: Move the two folders**

The destination **must** be inside `(superadmin)/`, or the page loses the guard in `(superadmin)/layout.tsx`.

```bash
cd "C:/Users/temp/Documents/VMaaS/admin-frontend/app/(protected)/(superadmin)"
mkdir -p machine-layout
mv "create-machine/[id]" "machine-layout/[id]"
mv "create-machine/components" "machine-layout/components"
```

The slot-grid-editor's internal imports are all relative within its own folder, so they need no change.

- [ ] **Step 3: Split the messages**

Create `machine-layout/messages.ts` by moving the four editor helpers out of `create-machine/messages.ts` verbatim — `machineLoadErrorMessage`, `saveLayoutErrorMessage`, `publishErrorMessage`, `configurationHistoryErrorMessage` — with their doc comments. Leave `createMachineErrorMessage` behind, since the create dialog is the only caller.

Then fix the importers. In `machine-layout/[id]/page.tsx` and `machine-layout/components/slot-grid-editor/slot-grid-editor.tsx` and `machine-layout/components/publish-panel.tsx`, the import path changes from `"../../messages"` to `"../messages"` (the folder is one level shallower now) — check each against its actual depth rather than assuming.

- [ ] **Step 4: Update the two outbound links**

`create-machine/create-machine-dialog.tsx` — after a successful create:

```ts
      router.push(`/machine-layout/${machine.id}`)
```

`create-machine/page.tsx` — the list row link:

```tsx
          render={<Link href={`/machine-layout/${machine.id}`} />}
```

`components/app-sidebar.tsx` stays untouched: it points at `/create-machine`, the list, which has not moved.

- [ ] **Step 5: Verify nothing broke**

Run: `cd C:\Users\temp\Documents\VMaaS\admin-frontend && npx tsc --noEmit 2>&1 | sort > C:\Users\temp\AppData\Local\Temp\tsc-after.txt && diff C:\Users\temp\AppData\Local\Temp\tsc-before.txt C:\Users\temp\AppData\Local\Temp\tsc-after.txt && echo IDENTICAL`

Expected: `IDENTICAL`. Any output from `diff` is a regression you introduced.

Then: `cd C:\Users\temp\Documents\VMaaS && grep -rn "create-machine/" admin-frontend/app admin-frontend/components --include=*.tsx --include=*.ts | grep -v node_modules`

Expected: only references to the list route `/create-machine`, none to `/create-machine/${...}`.

- [ ] **Step 6: Stop for review**

Report the diff result and the grep output. Do not commit.

---

### Task 2: Open the loader to claimed machines

**Files:**
- Modify: `backend/src/api/services/machines.service.ts` (`getMachineWithoutTenantService`, ~line 219-245)
- Modify: `backend/src/api/controllers/machines.controller.ts` (`getMachineWithoutTenantController`)
- Modify: `backend/src/api/routes/machines.route.ts`
- Modify: `admin-frontend/app/(protected)/(superadmin)/machine-layout/[id]/page.tsx`
- Test: `backend/src/api/services/__tests__/machines-layout-load.test.ts` (new)

**Interfaces:**
- Consumes: Task 1's moved page
- Produces: `getMachineForLayoutService(id: string): Promise<Result<MachineNotFoundError | UnknownMachineError, MachineWithoutTenant>>`, and the route `GET /api/machines/:id/layout`

- [ ] **Step 1: Write the failing test**

Create `backend/src/api/services/__tests__/machines-layout-load.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { machineFindFirst } = vi.hoisted(() => ({ machineFindFirst: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { machine: { findFirst: machineFindFirst } } }));

import { getMachineForLayoutService } from "@/api/services/machines.service";

const MACHINE = "33333333-3333-4333-8333-333333333333";
const TENANT = "11111111-1111-4111-8111-111111111111";

function machineRow(tenantId: string | null) {
  return { id: MACHINE, tenantId, site: null, slots: [] };
}

beforeEach(() => {
  machineFindFirst.mockReset();
});

describe("getMachineForLayoutService", () => {
  // The whole point of this change: a cabinet rebuilt in the field must be
  // re-describable, and it belongs to a tenant by then.
  it("returns a machine that already has a tenant", async () => {
    machineFindFirst.mockResolvedValue(machineRow(TENANT));

    const [error, machine] = await getMachineForLayoutService(MACHINE);

    expect(error).toBeNull();
    expect(machine?.id).toBe(MACHINE);
  });

  it("still returns a machine with no tenant", async () => {
    machineFindFirst.mockResolvedValue(machineRow(null));

    const [error] = await getMachineForLayoutService(MACHINE);

    expect(error).toBeNull();
  });

  // The guard that must NOT survive: a tenantId filter would make the first
  // test pass only by accident of the mock ignoring `where`.
  it("does not filter on tenantId", async () => {
    machineFindFirst.mockResolvedValue(machineRow(TENANT));

    await getMachineForLayoutService(MACHINE);

    const { where } = machineFindFirst.mock.calls[0][0];
    expect(where).toEqual({ id: MACHINE });
  });

  it("answers MACHINE_NOT_FOUND for an id that matches nothing", async () => {
    machineFindFirst.mockResolvedValue(null);

    const [error] = await getMachineForLayoutService(MACHINE);

    expect(error?.reason).toBe("MACHINE_NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:\Users\temp\Documents\VMaaS\backend && npx vitest run src/api/services/__tests__/machines-layout-load.test.ts`
Expected: FAIL — `getMachineForLayoutService` is not exported.

- [ ] **Step 3: Rename the service and drop the filter**

In `machines.service.ts`, rename `getMachineWithoutTenantService` to `getMachineForLayoutService`, change `where: { id, tenantId: null }` to `where: { id }`, and replace the doc comment — the existing one states the opposite of the new contract:

```ts
/**
 * One machine for the slot layout editor, claimed or not.
 *
 * It deliberately does NOT filter on `tenantId`. The layout describes the
 * cabinet's physics — how many slots there are, how big they are, and which
 * GPIO drives each motor — which is a property of the hardware rather than of
 * whoever owns it. A cabinet rebuilt in the field belongs to a tenant by then,
 * and had no way to be re-described while this read filtered them out.
 *
 * Authorisation is the route's job: `requireSuperAdmin` guards it, so opening
 * this read does not widen who may see a machine.
 */
export async function getMachineForLayoutService(
  id: string,
): Promise<Result<MachineNotFoundError | UnknownMachineError, MachineWithoutTenant>> {
```

Leave the `include` untouched — it already carries `site`, `slots` and their `pins`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:\Users\temp\Documents\VMaaS\backend && npx vitest run src/api/services/__tests__/machines-layout-load.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Move the route**

In `machines.route.ts`, replace the `/without-tenant/:id` route with one in the superadmin machine-scoped family, beside `publish-configuration` and `configurations`:

```ts
// The layout editor's read. Superadmin-only and deliberately not tenant-scoped:
// a claimed machine's cabinet can be rebuilt, and this is the only surface that
// can re-describe it.
machinesRouter.get(
  "/:id/layout",
  requireAuth,
  requireSuperAdmin,
  validate(machineIdParamsSchema),
  getMachineForLayoutController,
);
```

Rename `getMachineWithoutTenantController` to `getMachineForLayoutController` in `machines.controller.ts` and update both its import and its call to the renamed service. `GET /without-tenant` — the list — stays exactly as it is.

- [ ] **Step 6: Point the page at the new route**

In `machine-layout/[id]/page.tsx`:

```ts
  const [error, machine] = await fetchData<MachineWithoutTenant>(
    `/api/machines/${id}/layout`
  )
```

- [ ] **Step 7: Run both gates**

Run: `cd C:\Users\temp\Documents\VMaaS\backend && npm test`
Expected: PASS, 462 (458 + 4 new).

Run: `cd C:\Users\temp\Documents\VMaaS\admin-frontend && npx tsc --noEmit 2>&1 | sort | diff C:\Users\temp\AppData\Local\Temp\tsc-before.txt - && echo IDENTICAL`
Expected: `IDENTICAL`.

- [ ] **Step 8: Stop for review**

---

### Task 3: Name the device's slot ceiling

**Files:**
- Modify: `shared/types/slot.ts`
- Modify: `shared/schemas/device.ts:70`
- Test: `backend/src/api/__tests__/device-schemas.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `DEVICE_MAX_SLOT: 32` exported from `@vmaas/shared/types/slot`

- [ ] **Step 1: Write the failing test**

Append to `backend/src/api/__tests__/device-schemas.test.ts`. Merge the import into the file's existing `@vmaas/shared/schemas` import line rather than adding a second one; add a separate import for the constant.

```ts
describe("cashSalePayloadSchema — the device's slot ceiling", () => {
  const sale = (slot: number) =>
    cashSalePayloadSchema.safeParse({ slot, price_minor: 1500, received_minor: 1500, status: "completed" });

  it("accepts the highest slot the device can address", () => {
    expect(sale(DEVICE_MAX_SLOT).success).toBe(true);
  });

  // The firmware indexes `by_slot[MAX_SLOT + 1]`, so a higher number has no
  // cell to land in — it is not merely unusual, it is unrepresentable.
  it("rejects a slot above the ceiling", () => {
    expect(sale(DEVICE_MAX_SLOT + 1).success).toBe(false);
  });

  it("rejects slot 0, since slots are 1-based", () => {
    expect(sale(0).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:\Users\temp\Documents\VMaaS\backend && npx vitest run src/api/__tests__/device-schemas.test.ts`
Expected: FAIL — `DEVICE_MAX_SLOT` is not exported.

- [ ] **Step 3: Add the constant**

In `shared/types/slot.ts`, beside `LOW_STOCK_RATIO` and `LOW_STOCK_LIMIT`:

```ts
/**
 * The highest slot number a machine can address.
 *
 * Mirrors `MAX_SLOT` in `Main-Controller/src/prices.h`, which sizes
 * `by_slot[MAX_SLOT + 1]` — so this is a highest *number*, not a count. It is
 * deliberately NOT the same thing as `MAX_SLOTS` in
 * `shared/vmaas-config/src/slot_config.h`, which bounds how many rows the
 * wiring table holds. The two share the value 32 today and would diverge the
 * moment slots were numbered with gaps.
 *
 * A property of the board rather than of the domain: future hardware is
 * expected to carry more pins. Raising it means changing this constant AND
 * both firmware constants — nothing enforces that the three agree.
 */
export const DEVICE_MAX_SLOT = 32;
```

- [ ] **Step 4: Use it in the device schema**

In `shared/schemas/device.ts`, replace the bare literal:

```ts
  slot: z.coerce.number().int().min(1).max(DEVICE_MAX_SLOT),
```

Import `DEVICE_MAX_SLOT` from `../types/slot` — match the relative-import style the file already uses for shared types.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd C:\Users\temp\Documents\VMaaS\backend && npx vitest run src/api/__tests__/device-schemas.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the suite**

Run: `cd C:\Users\temp\Documents\VMaaS\backend && npm test`
Expected: PASS, 465 (462 + 3 new).

- [ ] **Step 7: Stop for review**

---

### Task 4: Refuse to delete a slot that holds stock

**Files:**
- Modify: `backend/src/api/services/machines.service.ts` (`saveSlotLayoutService`, the read at ~line 263 and the transaction)
- Test: `backend/src/api/services/__tests__/machines-save-layout-stock.test.ts` (new)

**Interfaces:**
- Consumes: nothing
- Produces: a new error reason `SLOTS_NOT_EMPTY` on `saveSlotLayoutService`, shaped `{ reason: "SLOTS_NOT_EMPTY"; message: string; slots: number[] }`

- [ ] **Step 1: Write the failing test**

Create `backend/src/api/services/__tests__/machines-save-layout-stock.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { machineFindUnique, slotDeleteMany, transaction } = vi.hoisted(() => ({
  machineFindUnique: vi.fn(),
  slotDeleteMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    machine: { findUnique: machineFindUnique },
    $transaction: transaction,
  },
}));

import { saveSlotLayoutService } from "@/api/services/machines.service";

const MACHINE = "33333333-3333-4333-8333-333333333333";
const SLOT_A = "11111111-1111-4111-8111-111111111111";
const SLOT_B = "22222222-2222-4222-8222-222222222222";

/** A layout that keeps SLOT_A and drops whatever else the machine has. */
function layoutKeepingA() {
  return {
    machineId: MACHINE,
    columns: 4,
    rows: 4,
    slots: [
      { id: SLOT_A, slotNumber: 1, beginX: 0, endX: 0, beginY: 0, endY: 0, capacity: 10, pins: [] },
    ],
  } as never;
}

beforeEach(() => {
  machineFindUnique.mockReset();
  slotDeleteMany.mockReset();
  transaction.mockReset();
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      slot: { deleteMany: slotDeleteMany, update: vi.fn(), createMany: vi.fn(), findMany: vi.fn(async () => []) },
      pin: { deleteMany: vi.fn(), createMany: vi.fn() },
    }),
  );
});

describe("saveSlotLayoutService — deleting a slot that holds stock", () => {
  it("refuses the whole save and names the slots", async () => {
    machineFindUnique.mockResolvedValue({
      id: MACHINE,
      slots: [
        { id: SLOT_A, slotNumber: 1, quantity: 0 },
        { id: SLOT_B, slotNumber: 5, quantity: 7 },
      ],
    });

    const [error] = await saveSlotLayoutService(layoutKeepingA());

    expect(error?.reason).toBe("SLOTS_NOT_EMPTY");
    expect(error?.slots).toEqual([5]);
  });

  // Nothing at all may be written — a partial save would renumber the slots
  // that stay while leaving the refused one behind.
  it("writes nothing when it refuses", async () => {
    machineFindUnique.mockResolvedValue({
      id: MACHINE,
      slots: [
        { id: SLOT_A, slotNumber: 1, quantity: 0 },
        { id: SLOT_B, slotNumber: 5, quantity: 7 },
      ],
    });

    await saveSlotLayoutService(layoutKeepingA());

    expect(transaction).not.toHaveBeenCalled();
  });

  it("allows deleting a slot that is empty", async () => {
    machineFindUnique.mockResolvedValue({
      id: MACHINE,
      slots: [
        { id: SLOT_A, slotNumber: 1, quantity: 0 },
        { id: SLOT_B, slotNumber: 5, quantity: 0 },
      ],
    });

    const [error] = await saveSlotLayoutService(layoutKeepingA());

    expect(error).toBeNull();
    expect(slotDeleteMany).toHaveBeenCalled();
  });

  // A slot that stays keeps its stock, so its quantity is none of this rule's
  // business — only removal is.
  it("ignores the stock of a slot the layout keeps", async () => {
    machineFindUnique.mockResolvedValue({
      id: MACHINE,
      slots: [{ id: SLOT_A, slotNumber: 1, quantity: 42 }],
    });

    const [error] = await saveSlotLayoutService(layoutKeepingA());

    expect(error).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:\Users\temp\Documents\VMaaS\backend && npx vitest run src/api/services/__tests__/machines-save-layout-stock.test.ts`
Expected: FAIL — the service does not read `quantity`, so no refusal happens and the first test gets `undefined` for `error`.

- [ ] **Step 3: Widen the read and add the rule**

In `saveSlotLayoutService`, change the machine read to carry what the rule needs:

```ts
    const machine = await prisma.machine.findUnique({
      where: { id: data.machineId },
      select: { id: true, slots: { select: { id: true, slotNumber: true, quantity: true } } },
    });
    if (!machine) return err(MACHINE_NOT_FOUND);
```

`storedIds` is currently built from `machine.slots.map((slot) => slot.id)` and still works unchanged.

After `removedIds` is computed and **before** `prisma.$transaction`, add:

```ts
    // A slot that disappears from the layout takes its recorded stock with it,
    // and InventoryMovement.slotId is onDelete: SetNull — so the ledger rows
    // survive but can no longer say which slot they were about. The operator
    // empties a cabinet physically before rebuilding it anyway, so refusing
    // here costs nothing and makes the loss impossible by accident.
    const removed = machine.slots.filter((slot) => removedIds.includes(slot.id));
    const stillStocked = removed.filter((slot) => slot.quantity > 0).map((slot) => slot.slotNumber);

    if (stillStocked.length > 0) {
      return err({
        reason: "SLOTS_NOT_EMPTY" as const,
        message: `These slots still hold stock and cannot be removed: ${stillStocked.map((n) => `#${n}`).join(", ")}`,
        slots: stillStocked,
      });
    }
```

Declare the error type beside the file's existing `SlotNotFoundError`, and add it to the function's `Result` union:

```ts
/** A layout save would remove a slot that still holds stock. Carries the slot
 *  numbers so the caller can name them; the message already does, but the array
 *  is what a UI would highlight if `HttpError` ever carried response bodies. */
export type SlotsNotEmptyError = { reason: "SLOTS_NOT_EMPTY"; message: string; slots: number[] };
```

```ts
export async function saveSlotLayoutService(
  data: SaveSlotLayoutData,
): Promise<Result<MachineNotFoundError | SlotNotFoundError | SlotsNotEmptyError | UnknownMachineError, Slot[]>> {
```

Drop the `as const` from the `reason` in the `err(...)` call once the type exists — the union now supplies the literal.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:\Users\temp\Documents\VMaaS\backend && npx vitest run src/api/services/__tests__/machines-save-layout-stock.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Map it to 422 in the controller**

In `machines.controller.ts`'s `saveSlotLayoutController`, add a case to the reason switch. 422 rather than 400: the request is well-formed, the machine's state is what refuses it — the same choice `publishConfigurationController` makes for `SLOTS_NOT_WIRED`.

```ts
      case "SLOTS_NOT_EMPTY":
        return res.status(422).json({ error: error.message, slots: error.slots }).end();
```

The `satisfies never` default will stop compiling until this case exists, which is the point of that pattern.

- [ ] **Step 6: Run the suite**

Run: `cd C:\Users\temp\Documents\VMaaS\backend && npm test`
Expected: PASS, 469 (465 + 4 new).

- [ ] **Step 7: Stop for review**

---

### Task 5: Compute and expose drift

**Files:**
- Modify: `backend/src/api/services/configuration-payload.ts`
- Modify: `backend/src/api/services/configuration.service.ts` (`publishConfigurationService`, `listConfigurationsService`)
- Modify: `backend/src/api/controllers/configuration.controller.ts`
- Test: `backend/src/api/services/__tests__/configuration-payload.test.ts` (extend)
- Test: `backend/src/api/services/__tests__/configuration-list.test.ts` (extend)

**Interfaces:**
- Consumes: `buildConfigurationPayload`, `PayloadSlot`, `ConfigurationPayload` from Task-6-of-the-previous-plan's module
- Produces:
  - `toPayloadSlots(rows: { slotNumber: number; price: unknown; product: { price: unknown } | null; pins: { number: number }[] }[]): PayloadSlot[]`
  - `comparePayloads(current: ConfigurationPayload, published: unknown): { wiring: boolean; prices: boolean }` — `true` means *differs*
  - `listConfigurationsService` returns `{ versions: [...], drift: { wiring: boolean; prices: boolean } | null }`

- [ ] **Step 1: Write the failing tests for the pure helpers**

Append to `backend/src/api/services/__tests__/configuration-payload.test.ts`:

```ts
describe("toPayloadSlots", () => {
  // Prisma hands back Decimal objects; the payload builder is deliberately
  // Prisma-free and works in plain numbers, so the conversion lives here.
  it("converts Decimal-like prices to numbers", () => {
    const rows = [{ slotNumber: 1, price: "12.50", product: { price: "15.00" }, pins: [{ number: 18 }] }];

    expect(toPayloadSlots(rows as never)).toEqual([
      { slotNumber: 1, price: 12.5, product: { price: 15 }, pins: [{ number: 18 }] },
    ]);
  });

  // Number(null) is 0, and 0 is a legitimate price — a free item. Preserving
  // null is what lets the payload builder fall back to the product's price.
  it("preserves a null slot price as null, not 0", () => {
    const rows = [{ slotNumber: 1, price: null, product: { price: "15.00" }, pins: [] }];

    expect(toPayloadSlots(rows as never)[0].price).toBeNull();
  });

  it("preserves an absent product as null", () => {
    const rows = [{ slotNumber: 1, price: "5.00", product: null, pins: [] }];

    expect(toPayloadSlots(rows as never)[0].product).toBeNull();
  });
});

describe("comparePayloads", () => {
  const payload = (wiringPins: number[], priceMinor: number) => ({
    cash: {},
    prices: [{ slot: 1, priceMinor }],
    wiring: { version: 2, slots: [{ slot: 1, pins: wiringPins }] },
  });

  it("reports no difference when both blocks match", () => {
    expect(comparePayloads(payload([18], 1500) as never, payload([18], 1500))).toEqual({
      wiring: false,
      prices: false,
    });
  });

  // The two blocks move for different reasons: prices change when a tenant
  // edits one in their own UI, wiring only changes in the layout editor.
  it("reports a wiring difference alone", () => {
    expect(comparePayloads(payload([19], 1500) as never, payload([18], 1500))).toEqual({
      wiring: true,
      prices: false,
    });
  });

  it("reports a price difference alone", () => {
    expect(comparePayloads(payload([18], 1600) as never, payload([18], 1500))).toEqual({
      wiring: false,
      prices: true,
    });
  });

  // A published payload from an older shape, or a hand-edited row, must not
  // throw — it simply differs.
  it("treats an unrecognisable published payload as differing in both", () => {
    expect(comparePayloads(payload([18], 1500) as never, null)).toEqual({ wiring: true, prices: true });
  });
});
```

Add `toPayloadSlots` and `comparePayloads` to the file's existing import from `@/api/services/configuration-payload`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd C:\Users\temp\Documents\VMaaS\backend && npx vitest run src/api/services/__tests__/configuration-payload.test.ts`
Expected: FAIL — neither helper is exported.

- [ ] **Step 3: Write the two pure helpers**

Append to `configuration-payload.ts`. Keep the module Prisma-free: the row type is structural, not imported from the generated client.

```ts
/** A Prisma row as this module sees it: Decimals are `unknown` until converted. */
type PayloadSlotRow = {
  slotNumber: number;
  price: unknown;
  product: { price: unknown } | null;
  pins: { number: number }[];
};

/**
 * Prisma rows to the plain shape the builder takes.
 *
 * `Number(null)` is 0 and 0 is a legitimate price, so a null price is
 * preserved rather than converted — that null is what makes the builder fall
 * back to the product's price instead of selling a free item.
 */
export function toPayloadSlots(rows: PayloadSlotRow[]): PayloadSlot[] {
  return rows.map((row) => ({
    slotNumber: row.slotNumber,
    price: row.price === null ? null : Number(row.price),
    product: row.product ? { price: Number(row.product.price) } : null,
    pins: row.pins,
  }));
}

/**
 * What differs between the machine's current rows and what was last published.
 *
 * The two blocks are compared separately because they move for different
 * reasons: `prices` changes when a tenant edits a slot price in their own UI,
 * while `wiring` changes only in the layout editor. Reporting one boolean would
 * make a price edit look like an unpublished rewiring.
 *
 * Compared as JSON rather than field by field: both sides are produced by
 * `buildConfigurationPayload`, which orders slots and pins deterministically,
 * so equal content serialises identically.
 *
 * @returns `true` for a block that DIFFERS.
 */
export function comparePayloads(
  current: ConfigurationPayload,
  published: unknown,
): { wiring: boolean; prices: boolean } {
  const stored = published as Partial<ConfigurationPayload> | null;

  if (stored === null || typeof stored !== "object") {
    return { wiring: true, prices: true };
  }

  return {
    wiring: JSON.stringify(current.wiring) !== JSON.stringify(stored.wiring),
    prices: JSON.stringify(current.prices) !== JSON.stringify(stored.prices),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd C:\Users\temp\Documents\VMaaS\backend && npx vitest run src/api/services/__tests__/configuration-payload.test.ts`
Expected: PASS, 18 (11 existing + 7 new).

- [ ] **Step 5: Use `toPayloadSlots` in the publish path**

`publishConfigurationService` currently maps the Prisma rows to `PayloadSlot[]` inline. Replace that mapping with a call to `toPayloadSlots(machine.slots)`, leaving everything else — the unwired check, the tenant gate, the version numbering — untouched. The behaviour must not change; this is so both callers share one conversion.

- [ ] **Step 6: Write the failing test for the list's drift**

Append to `backend/src/api/services/__tests__/configuration-list.test.ts`:

```ts
describe("listConfigurationsService — drift", () => {
  it("reports null drift when nothing has been published", async () => {
    machineFindFirst.mockResolvedValue({ id: MACHINE, slots: [] });
    configFindMany.mockResolvedValue([]);

    const [error, result] = await listConfigurationsService(MACHINE);

    expect(error).toBeNull();
    expect(result?.drift).toBeNull();
  });

  it("reports no drift when the current rows match the latest version", async () => {
    machineFindFirst.mockResolvedValue({
      id: MACHINE,
      slots: [{ slotNumber: 1, price: "15.00", product: null, pins: [{ number: 18 }] }],
    });
    configFindMany.mockResolvedValue([
      {
        version: 1,
        createdAt: new Date(),
        createdById: null,
        payload: { cash: {}, prices: [{ slot: 1, priceMinor: 1500 }], wiring: { version: 2, slots: [{ slot: 1, pins: [18] }] } },
      },
    ]);
    userFindMany.mockResolvedValue([]);

    const [, result] = await listConfigurationsService(MACHINE);

    expect(result?.drift).toEqual({ wiring: false, prices: false });
  });

  it("reports a wiring difference when a pin has changed since the last version", async () => {
    machineFindFirst.mockResolvedValue({
      id: MACHINE,
      slots: [{ slotNumber: 1, price: "15.00", product: null, pins: [{ number: 19 }] }],
    });
    configFindMany.mockResolvedValue([
      {
        version: 1,
        createdAt: new Date(),
        createdById: null,
        payload: { cash: {}, prices: [{ slot: 1, priceMinor: 1500 }], wiring: { version: 2, slots: [{ slot: 1, pins: [18] }] } },
      },
    ]);
    userFindMany.mockResolvedValue([]);

    const [, result] = await listConfigurationsService(MACHINE);

    expect(result?.drift).toEqual({ wiring: true, prices: false });
  });
});
```

The existing tests in this file assert on the returned array. They must be updated to read `result?.versions` instead — do that as part of this step, changing only the accessor, not the assertions.

- [ ] **Step 7: Run it to verify it fails**

Run: `cd C:\Users\temp\Documents\VMaaS\backend && npx vitest run src/api/services/__tests__/configuration-list.test.ts`
Expected: FAIL — the service returns an array, so `result?.drift` is undefined and `result?.versions` does not exist.

- [ ] **Step 8: Return drift from the list service**

In `listConfigurationsService`: widen the machine read to `select: { id: true, slots: { select: { slotNumber: true, price: true, product: { select: { price: true } }, pins: { select: { number: true } } } } }`, add `payload: true` to the `machineConfiguration.findMany` select, and change the return:

```ts
    // The newest row is the one the machine was last told about; drift is
    // measured against that, not against the whole history.
    const latest = rows[0];
    const drift = latest
      ? comparePayloads(buildConfigurationPayload(toPayloadSlots(machine.slots), {}), latest.payload)
      : null;

    return ok({
      versions: rows.map((row) => ({
        version: row.version,
        createdAt: row.createdAt,
        createdBy: row.createdById ? { name: nameById.get(row.createdById) ?? "Unknown" } : null,
      })),
      drift,
    });
```

The `versions` mapping is the file's existing one, unchanged — only its position moves, from the argument of `ok(...)` to a property inside it.

Update the function's return type accordingly. `PublishError` already covers `MACHINE_NOT_FOUND` and `UNKNOWN_ERROR`, so the error union does not change.

- [ ] **Step 9: Run the gates**

Run: `cd C:\Users\temp\Documents\VMaaS\backend && npx vitest run src/api/services/__tests__/configuration-list.test.ts`
Expected: PASS.

Run: `cd C:\Users\temp\Documents\VMaaS\backend && npm test`
Expected: PASS, 479 (469 + 7 payload + 3 list).

- [ ] **Step 10: Stop for review**

---

### Task 6: Show drift, blocked deletions and over-ceiling slots in the editor

**Files:**
- Modify: `admin-frontend/app/(protected)/(superadmin)/machine-layout/components/publish-panel.tsx`
- Modify: `admin-frontend/app/(protected)/(superadmin)/machine-layout/components/slot-grid-editor/components/slot-card.tsx`
- Modify: `admin-frontend/app/(protected)/(superadmin)/machine-layout/components/slot-grid-editor/components/slot-grid.tsx`
- Modify: `admin-frontend/app/(protected)/(superadmin)/machine-layout/components/slot-grid-editor/slot-grid-editor.tsx`
- Modify: `admin-frontend/app/(protected)/(superadmin)/machine-layout/messages.ts`

**Interfaces:**
- Consumes: Task 3's `DEVICE_MAX_SLOT`, Task 4's 422 with `slots`, Task 5's `{ versions, drift }`
- Produces: no new exports

- [ ] **Step 1: Read the new list shape in the panel**

`publish-panel.tsx` fetches `ConfigurationVersion[]`. Change the fetch type to `{ versions: ConfigurationVersion[]; drift: { wiring: boolean; prices: boolean } | null }`, set `versions` from `rows.versions`, and hold `drift` in its own state beside `historyError`.

- [ ] **Step 2: Render the drift line**

Above the version list. The wording must not claim the device is running anything — the backend knows what was **published**, not what was received, because the device does not fetch its configuration yet and does not report what it runs.

```tsx
      {drift && (drift.wiring || drift.prices) && (
        <p className="text-sm text-destructive">
          {drift.wiring && drift.prices
            ? `The wiring and the prices have changed since v${versions[0]?.version}.`
            : drift.wiring
              ? `The wiring has changed since v${versions[0]?.version}.`
              : `The prices have changed since v${versions[0]?.version}.`}{" "}
          Publish to record a new version.
        </p>
      )}
```

When `drift` is present and both flags are false, render nothing extra — the existing "Last published vN" row already says the machine is in step. Check that the panel's existing header text says **"Last published"** and not "the device is running"; correct it if it does.

- [ ] **Step 3: Mark slots above the device's ceiling**

`slot-card.tsx` already renders a pin line with a wired and an unwired branch. Add a third marker beside the slot number, so it reads independently of the wiring state:

```tsx
      <span className="flex items-center gap-1 text-xs font-semibold">
        #{slot.slotNumber}
        {slot.slotNumber > DEVICE_MAX_SLOT && (
          <TriangleAlert
            className="h-3 w-3 shrink-0 text-destructive"
            aria-label={`Slot ${slot.slotNumber} is above the ${DEVICE_MAX_SLOT} the machine can address`}
          />
        )}
      </span>
```

Import `DEVICE_MAX_SLOT` from `@vmaas/shared/types/slot`. Do **not** add `.max(DEVICE_MAX_SLOT)` to `slotLayoutSlotSchema` — existing machines already carry slot numbers above it, and rejecting the save would lock the user out of the very data they need to edit in order to fix it.

- [ ] **Step 4: Surface the blocked deletion**

In `machine-layout/messages.ts`, extend the save-layout message helper so a 422 says what happened. The response body carries `slots`, but `HttpError` is `{ reason, status }` and discards the body — so the message must be generic and actionable, the same compromise the publish 422 already makes:

```ts
  if (status === 422)
    return "A slot you removed still holds stock. Empty it in the machine's stock view first, then change the layout."
```

- [ ] **Step 5: Verify**

Run: `cd C:\Users\temp\Documents\VMaaS\admin-frontend && npx tsc --noEmit 2>&1 | sort | diff C:\Users\temp\AppData\Local\Temp\tsc-before.txt - && echo IDENTICAL`
Expected: `IDENTICAL`.

Run: `cd C:\Users\temp\Documents\VMaaS\backend && npm test`
Expected: still 479 — you touched no backend file.

- [ ] **Step 6: Stop for review**

---

### Task 7: The entry point and the state-aware back link

**Files:**
- Modify: `admin-frontend/app/(protected)/machines/[id]/machine-detail.tsx`
- Modify: `admin-frontend/app/(protected)/(superadmin)/machine-layout/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 1's route, Task 2's loader
- Produces: no new exports

- [ ] **Step 1: Add the superadmin control**

`MachineDetailLoader` is an async server component. Read the session the same way `(superadmin)/layout.tsx` does — `getSession` from `@/lib/dal`, called without an argument so it returns `Session | null` rather than redirecting, since a tenant user must still see the page:

```tsx
  const session = await getSession()
  const isSuperAdmin = session?.user.isSuperAdmin === true
```

Render the control beside the existing `<RoleGate perms={[PERMISSIONS.MACHINE_WRITE]}>` block:

```tsx
        {isSuperAdmin && (
          <Button
            variant="outline"
            render={<Link href={`/machine-layout/${id}`}>Edit layout</Link>}
          />
        )}
```

A plain `isSuperAdmin` check rather than a `<RoleGate>`: `RoleGate` takes permissions, and superadmin is a platform flag, not a permission. This only hides the control — the API's `requireSuperAdmin` and the page's `(superadmin)` layout guard are what actually enforce it.

- [ ] **Step 2: Make the back link follow the machine's state**

In `machine-layout/[id]/page.tsx` the back link is hardcoded to `/create-machine`, which is the wrong destination for a machine in service. The loader already has the machine, so branch on it. Move the link inside the loader if it currently sits in the static shell — it now depends on data:

```tsx
  const backHref = machine.tenantId ? `/machines/${machine.id}` : "/create-machine"
  const backLabel = machine.tenantId ? "Back to machine" : "Back to machines"
```

`machine-layout/[id]/not-found.tsx` keeps pointing at `/create-machine`: with no machine loaded there is nothing to branch on, and the unclaimed list is the safer destination.

- [ ] **Step 3: Verify**

Run: `cd C:\Users\temp\Documents\VMaaS\admin-frontend && npx tsc --noEmit 2>&1 | sort | diff C:\Users\temp\AppData\Local\Temp\tsc-before.txt - && echo IDENTICAL`
Expected: `IDENTICAL`.

- [ ] **Step 4: Stop for review**

---

## Manual verification

Restart both containers first — neither hot-reloads on this host:

```bash
docker restart backend admin-frontend
```

Then, signed in as `admin@mail.com` / `password123!` at `http://localhost`:

1. Open a **claimed** machine at `/machines/[id]`. The **Edit layout** control appears; a tenant-only user does not see it.
2. It opens `/machine-layout/[id]` and the grid loads with the machine's slots and pins. This is the behaviour the whole plan exists for — before it, this page answered 404.
3. Give a slot some stock in the machine's stock view, then delete that slot in the editor and save. Refused, with the message from Task 6 Step 4.
4. Empty the slot, delete it again, save. Accepted.
5. Change a pin and save. The panel reports that the wiring has changed since the last version; the prices are not mentioned.
6. Publish. The drift line disappears.
7. Change a slot's price in the tenant's own view, return, and reload. The panel now reports a **price** difference, not a wiring one.
8. The back link returns to `/machines/[id]`.
9. Open an **unclaimed** machine from `/create-machine`. Everything still works, and its back link returns to `/create-machine`.
10. On a machine with slots numbered above 32, those cards carry the ceiling warning while the save still succeeds.
