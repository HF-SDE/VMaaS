"""Find which keypad header pins are rows and which are columns.

Usage: python tools/keypad_discover.py COM6

Flash the discovery firmware first:
    pio run -e keypad-discover -t upload

The SparkFun COM-14662 pinout changed between revisions, so rather than trust
a datasheet this asks you to press all twelve keys in order and watches which
pin pair each one closes. A pin that appears in four pairs is a row; one that
appears in three is a column. Uses pyserial, which ships with PlatformIO's
penv python.
"""
import sys
import time

import serial

sys.stdout.reconfigure(errors="backslashreplace")

# Telephone layout, in the order the user is asked to press them.
KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]
ROWS_OF = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["*", "0", "#"],
]


def read_line(ser, deadline):
    """Read one newline-terminated line, or None once deadline passes."""
    buf = bytearray()
    while time.monotonic() < deadline:
        ch = ser.read(1)
        if not ch:
            continue
        if ch == b"\n":
            return buf.decode("utf-8", "replace").strip()
        if ch != b"\r":
            buf += ch
    return None


def wait_for(ser, want, timeout=60.0):
    """Wait for a line starting with `want`; return its whitespace split."""
    deadline = time.monotonic() + timeout
    while True:
        line = read_line(ser, deadline)
        if line is None:
            return None
        if line.startswith(want):
            return line.split()


def collect(ser):
    """Prompt for each key and record the pin pair it closes."""
    pairs = {}
    for key in KEYS:
        # Insist on a clean release first, so a held key is not read twice.
        print(f"Release everything, then press and hold: {key}", flush=True)
        wait_for(ser, "NONE", timeout=30.0)
        got = wait_for(ser, "PAIR", timeout=60.0)
        if got is None:
            print(f"  timed out waiting for {key}", file=sys.stderr)
            return None
        a, b = int(got[1]), int(got[2])
        pairs[key] = (a, b)
        print(f"  {key}: pins {a} and {b}", flush=True)
    return pairs


def classify(pairs):
    """Split the pins into rows and columns by how often each appears.

    A row carries one key per column, so a row pin shows up in 3 of the 12
    pairs. A column carries one key per row, so a column pin shows up in 4.
    Four pins at 3 and three pins at 4 is the only shape a healthy 4x3 matrix
    can produce.
    """
    counts = {}
    for a, b in pairs.values():
        counts[a] = counts.get(a, 0) + 1
        counts[b] = counts.get(b, 0) + 1

    rows = sorted(p for p, n in counts.items() if n == 3)
    cols = sorted(p for p, n in counts.items() if n == 4)

    if len(rows) != 4 or len(cols) != 3:
        print("Could not classify the pins. Counts per pin:", file=sys.stderr)
        for pin in sorted(counts):
            print(f"  GPIO{pin}: {counts[pin]} keys", file=sys.stderr)
        print(
            "Expected four pins at 3 keys (rows) and three at 4 (columns). "
            "A missing or shorted wire looks exactly like this.",
            file=sys.stderr,
        )
        return None, None
    return rows, cols


def order(pairs, rows, cols):
    """Put rows and columns in key-map order using the keys themselves."""
    ordered_rows = []
    for row_keys in ROWS_OF:
        pins = [p for p in pairs[row_keys[0]] if p in rows]
        ordered_rows.append(pins[0])

    ordered_cols = []
    for idx in range(3):
        key = ROWS_OF[0][idx]
        pins = [p for p in pairs[key] if p in cols]
        ordered_cols.append(pins[0])
    return ordered_rows, ordered_cols


def main() -> int:
    port = sys.argv[1] if len(sys.argv) > 1 else "COM6"
    with serial.Serial(port, 115200, timeout=0.2) as ser:
        ser.setDTR(False)
        ser.setRTS(True)
        time.sleep(0.1)
        ser.setRTS(False)
        if wait_for(ser, "READY", timeout=15.0) is None:
            print("No READY from the board. Is the discovery build flashed?",
                  file=sys.stderr)
            return 1

        pairs = collect(ser)
        if pairs is None:
            return 1

    if len(set(pairs.values())) != 12:
        print("Two keys reported the same pin pair. Check for a stuck key.",
              file=sys.stderr)
        return 1

    rows, cols = classify(pairs)
    if rows is None:
        return 1

    ordered_rows, ordered_cols = order(pairs, rows, cols)

    print("\nPaste into Main-Controller/src/pins.h:\n")
    print("    /// Keypad matrix rows, driven low one at a time.")
    print("    constexpr int KEYPAD_ROWS[4] = {%s};"
          % ", ".join(str(p) for p in ordered_rows))
    print("    /// Keypad matrix columns, inputs with internal pull-ups.")
    print("    constexpr int KEYPAD_COLS[3] = {%s};"
          % ", ".join(str(p) for p in ordered_cols))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
