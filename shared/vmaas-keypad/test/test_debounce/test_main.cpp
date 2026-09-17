/**
 * @file test_main.cpp
 * @brief Host tests for the time-domain debounce.
 *
 * The COM-14662 is a mechanical switch with 10-150 ohm contacts: one press
 * produces a burst of edges over roughly 10-20 ms. Without debounce a single
 * tap would enter four digits. These tests drive that burst explicitly rather
 * than trusting a delay, which is only possible because now_ms is injected.
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

// A 15 ms chatter burst is one press, not eight.
void test_bounce_burst_produces_exactly_one_pressed()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);

    uint32_t t = 0;
    kp.tick(t);
    for (int i = 0; i < 8; ++i)     // 8 edges over 16 ms, never settling
    {
        if (i % 2 == 0) port.press(0, 0); else port.release(0, 0);
        t += 2;
        kp.tick(t);
    }
    port.press(0, 0);               // settles closed at t = 16
    t = 16;
    kp.tick(t);
    KeyEvent evs[8];
    TEST_ASSERT_EQUAL_INT(0, drain(kp, evs, 8));   // nothing accepted yet

    kp.tick(16 + KEYPAD_DEFAULT_DEBOUNCE_MS);
    TEST_ASSERT_EQUAL_INT(1, drain(kp, evs, 8));
    TEST_ASSERT_EQUAL_CHAR('1', evs[0].key);
    TEST_ASSERT_EQUAL(KeyEventType::Pressed, evs[0].type);
}

// Nothing may be emitted before the state has held for the full debounce window.
void test_press_is_not_accepted_one_millisecond_early()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);

    kp.tick(0);
    port.press(1, 1);
    kp.tick(100);
    kp.tick(100 + KEYPAD_DEFAULT_DEBOUNCE_MS - 1);
    KeyEvent ev{};
    TEST_ASSERT_FALSE(kp.next_event(ev));

    kp.tick(100 + KEYPAD_DEFAULT_DEBOUNCE_MS);
    TEST_ASSERT_TRUE(kp.next_event(ev));
    TEST_ASSERT_EQUAL_CHAR('5', ev.key);
}

// Holding a key must not auto-repeat; the entry buffer would fill with one digit.
void test_hold_produces_no_repeat()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);

    kp.tick(0);
    port.press(2, 2);
    for (uint32_t t = 5; t <= 2000; t += 5)
        kp.tick(t);

    KeyEvent evs[8];
    TEST_ASSERT_EQUAL_INT(1, drain(kp, evs, 8));
    TEST_ASSERT_EQUAL_CHAR('9', evs[0].key);
}

// Release is an event too: the entry layer uses it to know the key is free again.
void test_release_produces_exactly_one_released_with_the_same_key()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);

    kp.tick(0);
    port.press(3, 0);
    kp.tick(10);
    kp.tick(10 + KEYPAD_DEFAULT_DEBOUNCE_MS);
    KeyEvent evs[8];
    TEST_ASSERT_EQUAL_INT(1, drain(kp, evs, 8));
    TEST_ASSERT_EQUAL_CHAR('*', evs[0].key);

    port.release(3, 0);
    kp.tick(200);
    kp.tick(200 + KEYPAD_DEFAULT_DEBOUNCE_MS);
    TEST_ASSERT_EQUAL_INT(1, drain(kp, evs, 8));
    TEST_ASSERT_EQUAL_CHAR('*', evs[0].key);
    TEST_ASSERT_EQUAL(KeyEventType::Released, evs[0].type);
}

// at_ms must be the moment the state was accepted, so the entry timeout is honest.
void test_event_timestamp_is_the_acceptance_time()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);

    kp.tick(0);
    port.press(0, 2);
    kp.tick(1000);
    kp.tick(1000 + KEYPAD_DEFAULT_DEBOUNCE_MS);
    KeyEvent ev{};
    TEST_ASSERT_TRUE(kp.next_event(ev));
    TEST_ASSERT_EQUAL_UINT32(1000 + KEYPAD_DEFAULT_DEBOUNCE_MS, ev.at_ms);
}

// A shorter window is a constructor argument, not a rebuild.
void test_debounce_window_is_configurable()
{
    FakeKeypadPort port;
    Keypad kp(port, 4);
    kp.begin(ROWS, 4, COLS, 3);

    kp.tick(0);
    port.press(0, 0);
    kp.tick(10);
    kp.tick(14);
    KeyEvent ev{};
    TEST_ASSERT_TRUE(kp.next_event(ev));
    TEST_ASSERT_EQUAL_CHAR('1', ev.key);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_bounce_burst_produces_exactly_one_pressed);
    RUN_TEST(test_press_is_not_accepted_one_millisecond_early);
    RUN_TEST(test_hold_produces_no_repeat);
    RUN_TEST(test_release_produces_exactly_one_released_with_the_same_key);
    RUN_TEST(test_event_timestamp_is_the_acceptance_time);
    RUN_TEST(test_debounce_window_is_configurable);
    return UNITY_END();
}
