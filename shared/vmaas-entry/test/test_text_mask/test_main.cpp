/**
 * @file test_main.cpp
 * @brief Host tests for TextEntry masking, the reveal key, and empty fields.
 *
 * The contract under test: a masked field shows the character at the cursor and
 * nothing else, 8 lifts that for two seconds, and '*' on an empty field leaves
 * the screen rather than doing nothing.
 */
#include <unity.h>
#include <cstring>
#include "text_entry.h"

using namespace vmaas;

namespace
{
    KeyEvent press(char k, uint32_t at_ms = 0)
    {
        return KeyEvent{k, KeyEventType::Pressed, at_ms};
    }

    TextEntryState type(TextEntry& e, const char* keys, uint32_t at_ms = 0)
    {
        TextEntryState st = e.state();
        for (const char* p = keys; *p != '\0'; ++p)
            st = e.handle(press(*p, at_ms));
        return st;
    }
}

void setUp() {}
void tearDown() {}

void test_unmasked_field_shows_everything()
{
    TextEntry e(16, false, true);
    TEST_ASSERT_EQUAL_STRING("ab", type(e, "5353").display);
}

void test_masked_field_shows_only_the_character_left_of_the_cursor()
{
    TextEntry e(16, true, true);
    // "ab" with the cursor at the end: the 'b' shows, the 'a' does not.
    TEST_ASSERT_EQUAL_STRING("*b", type(e, "5353").display);
}

void test_masking_follows_the_cursor_back_into_the_text()
{
    TextEntry e(16, true, true);
    type(e, "53535");             // "abc"
    TEST_ASSERT_EQUAL_STRING("**c", e.state().display);
    e.handle(press('4'));            // cursor between b and c
    TEST_ASSERT_EQUAL_STRING("*b*", e.state().display);
}

void test_cursor_at_zero_masks_everything()
{
    TextEntry e(16, true, true);
    type(e, "5353");                 // "ab"
    type(e, "44");                   // cursor to 0
    TEST_ASSERT_EQUAL_STRING("**", e.state().display);
}

void test_eight_reveals_the_whole_field()
{
    TextEntry e(16, true, true);
    type(e, "5353", 1000);
    e.handle(press('8', 1000));
    TEST_ASSERT_EQUAL_STRING("ab", e.state().display);
}

void test_reveal_ends_by_itself_after_two_seconds()
{
    TextEntry e(16, true, true);
    type(e, "5353", 1000);
    e.handle(press('8', 1000));
    TEST_ASSERT_EQUAL_STRING("ab", e.tick(1000 + TEXT_ENTRY_REVEAL_MS - 1).display);
    TEST_ASSERT_EQUAL_STRING("*b", e.tick(1000 + TEXT_ENTRY_REVEAL_MS).display);
}

void test_any_other_key_ends_the_reveal_at_once()
{
    TextEntry e(16, true, true);
    type(e, "5353", 1000);
    e.handle(press('8', 1000));
    TEST_ASSERT_EQUAL_STRING("ab", e.state().display);
    TEST_ASSERT_EQUAL_STRING("**c", e.handle(press('5', 1100)).display);
}

void test_eight_does_nothing_on_an_unmasked_field()
{
    TextEntry e(16, false, true);
    type(e, "5353");
    TEST_ASSERT_EQUAL_STRING("ab", e.handle(press('8')).display);
}

void test_star_on_an_empty_field_cancels()
{
    TextEntry e(16, true, true);
    TEST_ASSERT_EQUAL(TextEntryStatus::Cancelled, e.handle(press('*')).status);
}

void test_star_with_text_deletes_instead_of_cancelling()
{
    TextEntry e(16, true, true);
    type(e, "5");
    const TextEntryState st = e.handle(press('*'));
    TEST_ASSERT_EQUAL(TextEntryStatus::Editing, st.status);
    TEST_ASSERT_EQUAL_STRING("", st.text);
}

void test_hash_accepts_an_empty_password()
{
    TextEntry e(16, true, true);
    TEST_ASSERT_EQUAL(TextEntryStatus::Done, e.handle(press('#')).status);
}

void test_hash_refuses_an_empty_ssid()
{
    TextEntry e(32, false, false);
    TEST_ASSERT_EQUAL(TextEntryStatus::Editing, e.handle(press('#')).status);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_unmasked_field_shows_everything);
    RUN_TEST(test_masked_field_shows_only_the_character_left_of_the_cursor);
    RUN_TEST(test_masking_follows_the_cursor_back_into_the_text);
    RUN_TEST(test_cursor_at_zero_masks_everything);
    RUN_TEST(test_eight_reveals_the_whole_field);
    RUN_TEST(test_reveal_ends_by_itself_after_two_seconds);
    RUN_TEST(test_any_other_key_ends_the_reveal_at_once);
    RUN_TEST(test_eight_does_nothing_on_an_unmasked_field);
    RUN_TEST(test_star_on_an_empty_field_cancels);
    RUN_TEST(test_star_with_text_deletes_instead_of_cancelling);
    RUN_TEST(test_hash_accepts_an_empty_password);
    RUN_TEST(test_hash_refuses_an_empty_ssid);
    return UNITY_END();
}
