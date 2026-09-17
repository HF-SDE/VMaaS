/**
 * Rules for a machine's slot layout, shared so the admin editor and the backend check the same thing.
 *
 * Coordinates are 0-based and inclusive (a 1x1 slot has beginX === endX),
 * and y grows upwards, so y = 0 is the bottom row.
 */
export interface SlotRect {
  beginX: number;
  endX: number;
  beginY: number;
  endY: number;
}

export function slotsOverlap(a: SlotRect, b: SlotRect): boolean {
  return a.beginX <= b.endX && b.beginX <= a.endX && a.beginY <= b.endY && b.beginY <= a.endY;
}

/** Whether any two slots share a cell */
export function hasOverlappingSlots(slots: SlotRect[]): boolean {
  return slots.some((a, i) => slots.slice(i + 1).some((b) => slotsOverlap(a, b)));
}

/**
 * Slots that hover in the air: part of the cell row directly below them is empty.
 * Slots on the bottom row (beginY = 0) stand on the floor of the machine.
 *
 * Generic, so it returns the same slot objects it was given (e.g. Prisma slots or editor slots).
 */
export function findFloatingSlots<T extends SlotRect>(slots: T[]): T[] {
  const occupied = new Set<string>();
  for (const slot of slots) {
    for (let x = slot.beginX; x <= slot.endX; x++) {
      for (let y = slot.beginY; y <= slot.endY; y++) occupied.add(`${x}:${y}`);
    }
  }

  return slots.filter((slot) => {
    if (slot.beginY === 0) return false;

    for (let x = slot.beginX; x <= slot.endX; x++) {
      if (!occupied.has(`${x}:${slot.beginY - 1}`)) return true;
    }
    return false;
  });
}
