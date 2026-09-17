/**
 * @file test_main.cpp
 * @brief Host tests for the three entry rules the project owner settled.
 *
 * These are not derivable from the spec: each had more than one defensible
 * answer, and the owner picked on 2026-09-17. They are tested separately from
 * test_editing so that if a future owner changes their mind, exactly one
 * folder has to change and the settled behaviour stays untouched.
 *
 *   1. A digit against a full buffer shifts the oldest one out.
 *   2. '#' on an empty buffer cancels.
 *   3. A leading zero survives, so "07" is slot 7.
 */
#include <unity.h>
#include "slot_entry.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

static KeyEvent press(char k, uint32_t at_ms = 0)
{
    return KeyEvent{k, KeyEventType::Pressed, at_ms};
}

// Rule 1. Typing a third digit corrects the entry instead of being swallowed,
// so a customer who started with the wrong digit just keeps typing.
void test_third_digit_shifts_the_oldest_one_out()
{
    SlotEntry e;
    e.handle(press('1'));
    e.handle(press('2'));
    TEST_ASSERT_EQUAL_STRING("23", e.handle(press('3')).buffer);
}

// Rule 1 must keep working, not just shift once.
void test_shifting_repeats_for_every_further_digit()
{
    SlotEntry e;
    e.handle(press('1'));
    e.handle(press('2'));
    e.handle(press('3'));
    TEST_ASSERT_EQUAL_STRING("34", e.handle(press('4')).buffer);
    TEST_ASSERT_EQUAL_STRING("45", e.handle(press('5')).buffer);
}

// What was shifted in is what gets confirmed. This is the rule's real payload.
void test_a_shifted_buffer_confirms_as_the_visible_number()
{
    SlotEntry e;
    e.handle(press('1'));
    e.handle(press('2'));
    e.handle(press('3'));
    const EntryState out = e.handle(press('#'));
    TEST_ASSERT_EQUAL(EntryStatus::Confirmed, out.status);
    uint8_t slot = 0;
    TEST_ASSERT_TRUE(slot_number(out, slot));
    TEST_ASSERT_EQUAL_UINT8(23, slot);
}

// '*' still means "delete one" after a shift, not "undo the shift".
void test_star_after_a_shift_deletes_the_last_digit()
{
    SlotEntry e;
    e.handle(press('1'));
    e.handle(press('2'));
    e.handle(press('3'));           // "23"
    TEST_ASSERT_EQUAL_STRING("2", e.handle(press('*')).buffer);
}

// Rule 1 with a one-digit entry: every press replaces the previous one.
void test_shifting_works_with_a_single_digit_entry()
{
    SlotEntry e(1);
    TEST_ASSERT_EQUAL_STRING("5", e.handle(press('5')).buffer);
    TEST_ASSERT_EQUAL_STRING("8", e.handle(press('8')).buffer);
}

// Rule 2. Either key gets a customer out of an entry they did not mean to start.
void test_hash_on_an_empty_buffer_cancels()
{
    SlotEntry e;
    TEST_ASSERT_EQUAL(EntryStatus::Cancelled, e.handle(press('#')).status);
}

void test_hash_cancels_after_backspacing_to_empty()
{
    SlotEntry e;
    e.handle(press('4'));
    e.handle(press('*'));
    TEST_ASSERT_EQUAL(EntryStatus::Cancelled, e.handle(press('#')).status);
}

// Rule 3. The zero is kept in the buffer, so the display shows what was typed,
// and the parse turns it into the number the protocol wants.
void test_leading_zero_is_kept_and_parses_as_the_bare_number()
{
    SlotEntry e;
    TEST_ASSERT_EQUAL_STRING("0", e.handle(press('0')).buffer);
    TEST_ASSERT_EQUAL_STRING("07", e.handle(press('7')).buffer);

    const EntryState out = e.handle(press('#'));
    TEST_ASSERT_EQUAL(EntryStatus::Confirmed, out.status);
    TEST_ASSERT_EQUAL_STRING("07", out.buffer);
    uint8_t slot = 0;
    TEST_ASSERT_TRUE(slot_number(out, slot));
    TEST_ASSERT_EQUAL_UINT8(7, slot);
}

// A bare zero is a legal entry, not an empty one: it confirms as slot 0.
void test_a_lone_zero_confirms_as_slot_zero()
{
    SlotEntry e;
    e.handle(press('0'));
    const EntryState out = e.handle(press('#'));
    TEST_ASSERT_EQUAL(EntryStatus::Confirmed, out.status);
    uint8_t slot = 1;
    TEST_ASSERT_TRUE(slot_number(out, slot));
    TEST_ASSERT_EQUAL_UINT8(0, slot);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_third_digit_shifts_the_oldest_one_out);
    RUN_TEST(test_shifting_repeats_for_every_further_digit);
    RUN_TEST(test_a_shifted_buffer_confirms_as_the_visible_number);
    RUN_TEST(test_star_after_a_shift_deletes_the_last_digit);
    RUN_TEST(test_shifting_works_with_a_single_digit_entry);
    RUN_TEST(test_hash_on_an_empty_buffer_cancels);
    RUN_TEST(test_hash_cancels_after_backspacing_to_empty);
    RUN_TEST(test_leading_zero_is_kept_and_parses_as_the_bare_number);
    RUN_TEST(test_a_lone_zero_confirms_as_slot_zero);
    return UNITY_END();
}
