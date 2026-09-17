/**
 * @file test_main.cpp
 * @brief Host tests for the settled parts of the entry flow.
 *
 * These cover only behaviour fixed by the spec regardless of how the three
 * OWNER DECISION rules land: digits accumulate and echo, '*' deletes, '*' on
 * an empty buffer cancels, and '#' on a non-empty buffer confirms.
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

void test_digits_accumulate_in_order()
{
    SlotEntry e;
    TEST_ASSERT_EQUAL_STRING("1", e.handle(press('1')).buffer);
    TEST_ASSERT_EQUAL_STRING("12", e.handle(press('2')).buffer);
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.state().status);
}

void test_star_deletes_the_last_digit()
{
    SlotEntry e;
    e.handle(press('1'));
    e.handle(press('2'));
    TEST_ASSERT_EQUAL_STRING("1", e.handle(press('*')).buffer);
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.state().status);
}

void test_star_on_empty_buffer_cancels()
{
    SlotEntry e;
    TEST_ASSERT_EQUAL(EntryStatus::Cancelled, e.handle(press('*')).status);
}

void test_star_back_to_empty_then_star_cancels()
{
    SlotEntry e;
    e.handle(press('9'));
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.handle(press('*')).status);
    TEST_ASSERT_EQUAL(EntryStatus::Cancelled, e.handle(press('*')).status);
}

void test_hash_confirms_and_the_result_parses()
{
    SlotEntry e;
    e.handle(press('1'));
    e.handle(press('2'));
    const EntryState out = e.handle(press('#'));
    TEST_ASSERT_EQUAL(EntryStatus::Confirmed, out.status);
    TEST_ASSERT_EQUAL_STRING("12", out.buffer);
    uint8_t slot = 0;
    TEST_ASSERT_TRUE(slot_number(out, slot));
    TEST_ASSERT_EQUAL_UINT8(12, slot);
}

// After a decision the object must be ready for the next customer.
void test_confirm_leaves_the_entry_empty()
{
    SlotEntry e;
    e.handle(press('7'));
    e.handle(press('#'));
    TEST_ASSERT_EQUAL_STRING("", e.state().buffer);
    TEST_ASSERT_EQUAL(EntryStatus::Editing, e.state().status);
}

void test_cancel_leaves_the_entry_empty()
{
    SlotEntry e;
    e.handle(press('*'));
    TEST_ASSERT_EQUAL_STRING("", e.state().buffer);
}

void test_reset_clears_a_partial_entry()
{
    SlotEntry e;
    e.handle(press('4'));
    e.reset();
    TEST_ASSERT_EQUAL_STRING("", e.state().buffer);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_digits_accumulate_in_order);
    RUN_TEST(test_star_deletes_the_last_digit);
    RUN_TEST(test_star_on_empty_buffer_cancels);
    RUN_TEST(test_star_back_to_empty_then_star_cancels);
    RUN_TEST(test_hash_confirms_and_the_result_parses);
    RUN_TEST(test_confirm_leaves_the_entry_empty);
    RUN_TEST(test_cancel_leaves_the_entry_empty);
    RUN_TEST(test_reset_clears_a_partial_entry);
    return UNITY_END();
}
