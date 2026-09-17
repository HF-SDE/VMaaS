# vmaas-entry

Turns key events into a slot number. `SlotEntry` consumes `vmaas::KeyEvent`
values and returns `vmaas::EntryState` values - that is the whole interface.

It includes no ESP-IDF header, no FreeRTOS header and no GPIO. The only thing
it borrows from `vmaas-keypad` is `key_event.h`, which is header-only and
holds nothing but a struct. That is deliberate: the purchase flow and the
simulator have to drive the same entry logic the board runs, and logic that
can only be exercised on hardware cannot be trusted by either.

## The status lifecycle

`Editing` is the resting state. `Confirmed`, `Cancelled` and `TimedOut` are
**transient**: they are reported exactly once, and the `SlotEntry` has already
reset itself by the time the caller sees them.

```cpp
const vmaas::EntryState out = entry.handle(ev);
if (out.status == vmaas::EntryStatus::Confirmed) { /* act on it now */ }
// entry.state() is already Editing with an empty buffer here
```

This is why `slot_number()` is a free function over a returned `EntryState`
rather than a member of `SlotEntry`: by the time you could call a member, the
buffer it would read is gone.

A consequence worth knowing when driving a display: the caller must hold a
result on screen itself. `Main-Controller/src/main.cpp` keeps it up for two
seconds, because the next loop iteration is handed an empty `Editing` state
roughly 50 ms later and would otherwise overwrite the confirmation before
anyone could read it.

## The entry rules

| Key | Buffer state | Result |
|-----|--------------|--------|
| `0`-`9` | room left | digit appended |
| `0`-`9` | full | **oldest digit shifted out**, new one appended |
| `*` | non-empty | last digit deleted |
| `*` | empty | `Cancelled` |
| `#` | non-empty | `Confirmed` |
| `#` | empty | `Cancelled` |
| any | 10 s of inactivity | `TimedOut`, buffer discarded |

Three of these were judgement calls, not deductions:

**A third digit shifts rather than being ignored.** Typing `1`, `2`, `3`
leaves `23`. A customer who started with the wrong digit keeps typing instead
of clicking on `*`. It also means the entry is never in a state where pressing
a key does nothing.

**`#` on an empty buffer cancels** rather than doing nothing, so either key
gets a customer out of an entry they did not mean to start.

**A leading zero survives.** `07` stays `07` in the buffer, so the display
shows what was actually typed, and `slot_number()` parses it to 7. A bare `0`
is a legal entry meaning slot 0, not an empty one.

Only `Pressed` events are acted on; `Released` events are accepted and
ignored, so a caller can forward everything the keypad emits without
filtering. They also do not count as activity, or the timeout would never fire
while a finger rested on a key.

## Usage

```cpp
vmaas::SlotEntry entry(vmaas::SLOT_ENTRY_MAX_DIGITS, Config::slot_entry_timeout_ms);

vmaas::KeyEvent ev;
while (keypad.next_event(ev))
    render(entry.handle(ev));

render(entry.tick(now_ms()));   // drives the timeout
```

## Tests

Run from this directory: `pio test -e native`

| Folder | Covers |
|--------|--------|
| `test_entry_state` | `EntryStatus::Editing` is 0, distinct names, `slot_number()` parsing and its rejections |
| `test_editing` | Digits accumulate, `*` deletes, `*` on empty cancels, `#` confirms, the entry is empty again afterwards |
| `test_timeout` | Empty buffers never time out, a partial entry is discarded once, each keypress restarts the window, zero disables it, `Released` is not activity |
| `test_rules` | The three owner decisions above, including that a shifted buffer confirms as the number on screen |

`test_rules` is separate on purpose. If a future owner changes their mind
about one of the three, exactly one folder changes and the settled behaviour
stays untouched.
