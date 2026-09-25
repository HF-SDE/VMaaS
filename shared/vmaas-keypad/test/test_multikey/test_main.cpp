/**
 * @file test_main.cpp
 * @brief Host tests for the one-key-at-a-time rule, ghosting and queue overflow.
 *
 * The COM-14662 has no diodes. With three switches closed in an L shape,
 * current reaches a fourth intersection and the scan reads a key nobody
 * touched. FakeKeypadPort reproduces that by flooding the switch graph, so
 * the phantom is real here rather than assumed away. The driver's answer is
 * to report at most one key, which these tests hold it to.
 */
#include <unity.h>
#include "keypad.h"
#include "../fake_keypad_port.h"

using namespace vmaas;

static const int ROWS[4] = {14, 25, 26, 27};
static const int COLS[3] = {18, 19, 23};

void setUp() {}
void tearDown() {}

static int drain(Keypad& kp, KeyEvent* out, int max)
{
    int n = 0;
    KeyEvent ev{};
    while (n < max && kp.next_event(ev))
        out[n++] = ev;
    return n;
}

// Settle a changed matrix state through the debounce window.
static void settle(Keypad& kp, uint32_t& t)
{
    t += 5;
    kp.tick(t);
    t += KEYPAD_DEFAULT_DEBOUNCE_MS;
    kp.tick(t);
}

// The second key is ignored while the first is held.
void test_second_key_is_ignored_until_the_first_is_released()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);
    uint32_t t = 0;
    kp.tick(t);

    port.press(0, 0);                 // '1'
    settle(kp, t);
    KeyEvent evs[8];
    TEST_ASSERT_EQUAL_INT(1, drain(kp, evs, 8));
    TEST_ASSERT_EQUAL_CHAR('1', evs[0].key);

    port.press(1, 1);                 // '5' while '1' is still down
    settle(kp, t);
    TEST_ASSERT_EQUAL_INT(0, drain(kp, evs, 8));
}

// An ignored key must not emit a Released when it comes back up.
void test_ignored_key_emits_nothing_on_release()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);
    uint32_t t = 0;
    kp.tick(t);

    port.press(0, 0);
    settle(kp, t);
    KeyEvent evs[8];
    drain(kp, evs, 8);

    port.press(1, 1);
    settle(kp, t);
    port.release(1, 1);
    settle(kp, t);
    TEST_ASSERT_EQUAL_INT(0, drain(kp, evs, 8));

    port.release(0, 0);
    settle(kp, t);
    TEST_ASSERT_EQUAL_INT(1, drain(kp, evs, 8));
    TEST_ASSERT_EQUAL_CHAR('1', evs[0].key);
    TEST_ASSERT_EQUAL(KeyEventType::Released, evs[0].type);
}

// After the first key is released the keypad accepts the next one normally.
void test_next_key_works_after_release()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);
    uint32_t t = 0;
    kp.tick(t);
    KeyEvent evs[8];

    port.press(0, 0);
    settle(kp, t);
    drain(kp, evs, 8);
    port.release(0, 0);
    settle(kp, t);
    drain(kp, evs, 8);

    port.press(3, 2);                 // '#'
    settle(kp, t);
    TEST_ASSERT_EQUAL_INT(1, drain(kp, evs, 8));
    TEST_ASSERT_EQUAL_CHAR('#', evs[0].key);
}

// The classic L: (0,0), (0,1) and (1,0) closed make (1,1) read as pressed.
// The fake really produces that phantom; the driver must never report it.
void test_three_keys_never_report_a_phantom_fourth()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);
    uint32_t t = 0;
    kp.tick(t);
    KeyEvent evs[8];

    port.press(0, 0);
    port.press(0, 1);
    port.press(1, 0);
    settle(kp, t);

    const int n = drain(kp, evs, 8);
    TEST_ASSERT_TRUE(n <= 1);
    for (int i = 0; i < n; ++i)
        TEST_ASSERT_TRUE(evs[i].key != '5');   // '5' is (1,1), the phantom
}

// Confirm the fake models ghosting, so the test above is not passing by luck.
void test_fake_port_really_ghosts()
{
    FakeKeypadPort port;
    port.press(0, 0);
    port.press(0, 1);
    port.press(1, 0);
    port.drive_row(0, true);
    port.drive_row(1, false);          // select row 1 only
    port.drive_row(2, true);
    port.drive_row(3, true);
    TEST_ASSERT_FALSE(port.read_col(1));   // (1,1) reads low although it is open
}

// A main loop that stalls must lose the newest events, not corrupt the queue,
// and must be able to say how many it lost.
void test_queue_overflow_drops_and_counts()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);
    uint32_t t = 0;
    kp.tick(t);

    // 20 press/release pairs = 40 events into a 16-slot queue, never drained.
    for (int i = 0; i < 20; ++i)
    {
        port.press(0, 0);
        settle(kp, t);
        port.release(0, 0);
        settle(kp, t);
    }

    TEST_ASSERT_TRUE(kp.dropped_events() > 0);

    KeyEvent evs[32];
    const int n = drain(kp, evs, 32);
    TEST_ASSERT_EQUAL_INT(16, n);
    TEST_ASSERT_EQUAL_CHAR('1', evs[0].key);          // oldest kept
    TEST_ASSERT_EQUAL(KeyEventType::Pressed, evs[0].type);
    TEST_ASSERT_EQUAL_UINT32(40u - 16u, kp.dropped_events());
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_second_key_is_ignored_until_the_first_is_released);
    RUN_TEST(test_ignored_key_emits_nothing_on_release);
    RUN_TEST(test_next_key_works_after_release);
    RUN_TEST(test_three_keys_never_report_a_phantom_fourth);
    RUN_TEST(test_fake_port_really_ghosts);
    RUN_TEST(test_queue_overflow_drops_and_counts);
    return UNITY_END();
}
