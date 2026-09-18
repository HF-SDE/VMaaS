/**
 * @file test_main.cpp
 * @brief Host tests for TextEntry: characters, cursor and the picker row.
 *
 * The contract under test: every key does one thing, the picker row is always
 * exactly 16 columns with the selection bracketed, and the cursor can go back
 * into the text so a typo does not cost the whole field.
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

    // Feeds a whole string of key presses, left to right.
    TextEntryState type(TextEntry& e, const char* keys)
    {
        TextEntryState st = e.state();
        for (const char* p = keys; *p != '\0'; ++p)
            st = e.handle(press(*p));
        return st;
    }
}

void setUp() {}
void tearDown() {}

void test_insert_puts_the_selected_character_in_the_text()
{
    TextEntry e(16, false, true);
    // Charset starts at Lower with 'a' selected, so 5 inserts 'a'.
    TEST_ASSERT_EQUAL_STRING("a", type(e, "5").text);
}

void test_three_steps_forward_then_insert()
{
    TextEntry e(16, false, true);
    TEST_ASSERT_EQUAL_STRING("d", type(e, "3335").text);
}

void test_one_steps_back_and_stops_at_the_start()
{
    TextEntry e(16, false, true);
    // 'a' is the first character: 1 cannot go below it.
    TEST_ASSERT_EQUAL_STRING("a", type(e, "115").text);
}

void test_nine_jumps_five_forward()
{
    TextEntry e(16, false, true);
    TEST_ASSERT_EQUAL_STRING("f", type(e, "95").text);
}

void test_seven_jumps_five_back_and_clamps()
{
    TextEntry e(16, false, true);
    // 9 to 'f', then 7 back to 'a', then 7 again stays at 'a'.
    TEST_ASSERT_EQUAL_STRING("a", type(e, "9775").text);
}

void test_two_cycles_the_charsets_and_wraps()
{
    TextEntry e(16, false, true);
    TEST_ASSERT_EQUAL_STRING("A", type(e, "25").text);          // Lower -> Upper
    e.reset();
    TEST_ASSERT_EQUAL_STRING("0", type(e, "225").text);         // -> Digits
    e.reset();
    TEST_ASSERT_EQUAL_STRING("!", type(e, "2225").text);        // -> Symbols
    e.reset();
    TEST_ASSERT_EQUAL_STRING("a", type(e, "22225").text);       // wraps to Lower
}

void test_charset_switch_resets_the_selection_to_the_first_character()
{
    TextEntry e(16, false, true);
    // Move well into a-z, switch to Upper: selection must be 'A', not the 10th letter.
    TEST_ASSERT_EQUAL_STRING("A", type(e, "99925").text);
}

void test_zero_inserts_a_space()
{
    TextEntry e(16, false, true);
    TEST_ASSERT_EQUAL_STRING("a b", type(e, "5035").text);
}

void test_star_deletes_the_character_left_of_the_cursor()
{
    TextEntry e(16, false, true);
    TEST_ASSERT_EQUAL_STRING("a", type(e, "535*").text);
}

void test_cursor_can_go_back_and_insert_in_the_middle()
{
    TextEntry e(16, false, true);
    // Type "ac", move left once, insert 'b' -> "abc".
    type(e, "5335");               // "ac"
    TEST_ASSERT_EQUAL_STRING("ac", e.state().text);
    type(e, "4");                  // cursor between a and c
    // Selection is still at 'c' (index 2) from the earlier "33"; one '1'
    // step back reaches 'b' (index 1). (Brief's original key sequence
    // "115" has an extra '1' and lands on 'a' instead - see task-1-report.md.)
    TEST_ASSERT_EQUAL_STRING("abc", type(e, "15").text);
}

void test_cursor_clamps_at_both_ends()
{
    TextEntry e(16, false, true);
    type(e, "5");                  // "a", cursor at 1
    type(e, "4444");               // cannot go below 0
    TEST_ASSERT_EQUAL_STRING("ba", type(e, "35").text);
    type(e, "6666");               // cannot go past the end
    TEST_ASSERT_EQUAL_STRING("baa", type(e, "115").text);
}

void test_max_length_is_respected()
{
    TextEntry e(3, false, true);
    type(e, "5555");               // four inserts into a field of three
    TEST_ASSERT_EQUAL_STRING("aaa", e.state().text);
}

void test_picker_row_is_always_sixteen_columns()
{
    TextEntry e(16, false, true);
    TEST_ASSERT_EQUAL_UINT(16, std::strlen(e.state().picker));
    type(e, "999");                // deep into the table
    TEST_ASSERT_EQUAL_UINT(16, std::strlen(e.state().picker));
    type(e, "2");                  // shortest table (Digits has 10)
    TEST_ASSERT_EQUAL_UINT(16, std::strlen(e.state().picker));
}

void test_picker_row_brackets_the_selection()
{
    TextEntry e(16, false, true);
    type(e, "999");                // selection is 'p' (index 15)
    const TextEntryState st = e.state();
    const char* open = std::strchr(st.picker, '[');
    TEST_ASSERT_NOT_NULL(open);
    TEST_ASSERT_EQUAL_CHAR('p', open[1]);
    TEST_ASSERT_EQUAL_CHAR(']', open[2]);
}

void test_picker_row_at_the_start_of_the_table()
{
    TextEntry e(16, false, true);
    // Selection is 'a', the very first character: the bracket has to open the row.
    TEST_ASSERT_EQUAL_STRING("[a]b c d e f g h", e.state().picker);
}

void test_display_window_follows_the_cursor_past_column_sixteen()
{
    TextEntry e(32, false, true);
    // Types a, b, c, ... t (20 letters): insert 'a', then repeatedly step
    // the picker forward one and insert the new selection.
    type(e, "5");
    for (int i = 0; i < 19; ++i)
        type(e, "35");
    TEST_ASSERT_EQUAL_STRING("abcdefghijklmnopqrst", e.state().text);

    const TextEntryState st = e.state();
    // 20 columns cannot fit in 16: the window must still be exactly 16 wide,
    // and it must show the tail (where the cursor is), not the head.
    TEST_ASSERT_EQUAL_UINT(16, std::strlen(st.display));
    TEST_ASSERT_EQUAL_STRING("efghijklmnopqrst", st.display);
}

void test_display_window_scrolls_back_when_the_cursor_moves_left()
{
    TextEntry e(32, false, true);
    type(e, "5");
    for (int i = 0; i < 19; ++i)
        type(e, "35");
    // Cursor is at the end (20, showing "efghijklmnopqrst"); walk it back
    // into the text and the window must scroll back with it.
    const TextEntryState st = type(e, "444");
    TEST_ASSERT_EQUAL_UINT(16, std::strlen(st.display));
    TEST_ASSERT_EQUAL_STRING("bcdefghijklmnopq", st.display);
}

void test_masked_display_window_reveals_only_the_character_left_of_the_cursor()
{
    TextEntry e(32, true, true);
    // Types 17 letters, a..q, scrolling the window past column sixteen.
    type(e, "5");
    for (int i = 0; i < 16; ++i)
        type(e, "35");
    TEST_ASSERT_EQUAL_STRING("abcdefghijklmnopq", e.state().text);

    const TextEntryState st = e.state();
    TEST_ASSERT_EQUAL_UINT(16, std::strlen(st.display));
    // Window is buffer[1..16] ('b'..'q'); only 'q', left of the cursor, is
    // clear - everything else in the masked field shows as '*'.
    char expected[17];
    for (int i = 0; i < 15; ++i)
        expected[i] = '*';
    expected[15] = 'q';
    expected[16] = '\0';
    TEST_ASSERT_EQUAL_STRING(expected, st.display);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_insert_puts_the_selected_character_in_the_text);
    RUN_TEST(test_three_steps_forward_then_insert);
    RUN_TEST(test_one_steps_back_and_stops_at_the_start);
    RUN_TEST(test_nine_jumps_five_forward);
    RUN_TEST(test_seven_jumps_five_back_and_clamps);
    RUN_TEST(test_two_cycles_the_charsets_and_wraps);
    RUN_TEST(test_charset_switch_resets_the_selection_to_the_first_character);
    RUN_TEST(test_zero_inserts_a_space);
    RUN_TEST(test_star_deletes_the_character_left_of_the_cursor);
    RUN_TEST(test_cursor_can_go_back_and_insert_in_the_middle);
    RUN_TEST(test_cursor_clamps_at_both_ends);
    RUN_TEST(test_max_length_is_respected);
    RUN_TEST(test_picker_row_is_always_sixteen_columns);
    RUN_TEST(test_picker_row_brackets_the_selection);
    RUN_TEST(test_picker_row_at_the_start_of_the_table);
    RUN_TEST(test_display_window_follows_the_cursor_past_column_sixteen);
    RUN_TEST(test_display_window_scrolls_back_when_the_cursor_moves_left);
    RUN_TEST(test_masked_display_window_reveals_only_the_character_left_of_the_cursor);
    return UNITY_END();
}
