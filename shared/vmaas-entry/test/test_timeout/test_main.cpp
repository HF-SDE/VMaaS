/**
 * @file test_main.cpp
 * @brief Host tests for the inactivity timeout.
 *
 * A vending machine left with "1" on the display is a machine the next
 * customer mis-uses. The timeout is what clears it, and because now_ms is
 * injected these tests run instantly instead of waiting ten seconds.
 */
#include <unity.h>
#include "slot_entry.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

static KeyEvent press(char k, uint32_t at_ms)
{
    return KeyEvent{k, KeyEventType::Pressed, at_ms};
}

// Nothing typed means nothing to discard: the timeout must stay quiet.
void test_empty_buffer_never_times_out()
{
    SlotEntry e;
    for (uint32_t t = 0; t < 60000; t += 1000)
        TEST_ASSERT_EQUAL(EntryStatus::Editing, e.tick(t).status);
}

// A partial entry is discarded after the window, and reported once.
void test_partial_entry_times_out_and_clears()
{
    SlotEntry e;
    e.handle(press('1', 1000));
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.tick(1000 + SLOT_ENTRY_TIMEOUT_MS - 1).status);

    const EntryState out = e.tick(1000 + SLOT_ENTRY_TIMEOUT_MS);
    TEST_ASSERT_EQUAL(EntryStatus::TimedOut, out.status);
    TEST_ASSERT_EQUAL_STRING("1", out.buffer);

    // Reported once; the object is already empty.
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.tick(1000 + SLOT_ENTRY_TIMEOUT_MS + 1).status);
    TEST_ASSERT_EQUAL_STRING("", e.state().buffer);
}

// Every keypress buys another full window.
void test_each_keypress_restarts_the_window()
{
    SlotEntry e;
    e.handle(press('1', 0));
    e.handle(press('2', 9000));
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.tick(10000).status);
    TEST_ASSERT_EQUAL(EntryStatus::TimedOut, e.tick(19000).status);
}

// A zero timeout disables the feature outright.
void test_zero_timeout_disables_it()
{
    SlotEntry e(2, 0);
    e.handle(press('1', 0));
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.tick(1000000).status);
}

// Released events must not act as activity or the timeout would never fire
// while a finger rests on a key.
void test_released_events_are_ignored()
{
    SlotEntry e;
    e.handle(press('1', 0));
    e.handle(KeyEvent{'1', KeyEventType::Released, 5000});
    TEST_ASSERT_EQUAL(EntryStatus::TimedOut, e.tick(SLOT_ENTRY_TIMEOUT_MS).status);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_empty_buffer_never_times_out);
    RUN_TEST(test_partial_entry_times_out_and_clears);
    RUN_TEST(test_each_keypress_restarts_the_window);
    RUN_TEST(test_zero_timeout_disables_it);
    RUN_TEST(test_released_events_are_ignored);
    return UNITY_END();
}
