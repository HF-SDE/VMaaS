/**
 * @file test_main.cpp
 * @brief Host tests for Overflow::Scroll, tick(), stop_scroll() and the scrolling-row rules.
 *
 * A marquee is text + 3 spaces of padding shown through a window from the
 * cursor column to column 15; tick(now_ms) shifts it one character per
 * scroll interval. Time is passed in, so the tests drive tick() with exact
 * millisecond values (including a uint32 wrap-around). LONG_TEXT is 18 chars,
 * so it never fits the 16-column row and always scrolls from column 0.
 *
 * The second half covers what happens when a print lands on a scrolling row:
 * the marquee is stopped, its window is blanked, and only then is the new
 * text written, so no tail of the old text stays visible. stop_scroll(),
 * clear_row() and clear() stop a marquee without writing new text.
 */
#include <unity.h>
#include <cstring>
#include <string>
#include "../fake_port.h"
#include "grove_lcd_rgb.h"

using namespace vmaas;

namespace
{
    constexpr uint8_t LCD = 0x3E;
    constexpr uint8_t RGB_V5 = 0x30;
    const char* LONG_TEXT = "Display smoke test"; // 18 chars, > 16

    struct Fixture
    {
        FakePort port;
        GroveLcdRgb lcd{port};
        Fixture()
        {
            port.nak(RGB_V5);
            lcd.begin();
            port.clear();
        }
    };

    std::string payload(const std::vector<uint8_t>& w)
    {
        return std::string(w.begin() + 1, w.end());
    }
}

void setUp() {}
void tearDown() {}

// Scroll mode on text that fits behaves like a plain print: written once, no marquee, row not protected.
void test_scroll_text_that_fits_is_written_once_and_never_scrolls()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("short", Overflow::Scroll));
    TEST_ASSERT_EQUAL(1, f.port.write_count());
    f.lcd.tick(0);
    f.lcd.tick(10000);
    TEST_ASSERT_EQUAL(1, f.port.write_count());
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print_at(0, 0, "x", Overflow::Truncate));
}

// The first 16 characters appear at once; the caller does not have to wait for a tick.
void test_scroll_draws_offset_zero_immediately()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print(LONG_TEXT, Overflow::Scroll));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(2, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0x80}));
    TEST_ASSERT_EQUAL_STRING("Display smoke te", payload(w[1]).c_str());
}

// The first tick only records the time; the text moves one character once the 300 ms interval has passed.
void test_first_tick_primes_then_steps_after_interval()
{
    Fixture f;
    f.lcd.print(LONG_TEXT, Overflow::Scroll);
    f.port.clear();
    f.lcd.tick(1000);
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    f.lcd.tick(1299);
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    f.lcd.tick(1300);
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(2, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0x80}));
    TEST_ASSERT_EQUAL_STRING("isplay smoke tes", payload(w[1]).c_str());
}

// 18 chars + 3 spaces = 21 offsets per cycle; offset 20 shows the last space then the text start, offset 21 wraps to 0.
void test_scroll_wraps_around_with_three_space_padding()
{
    Fixture f;
    f.lcd.print(LONG_TEXT, Overflow::Scroll);
    f.lcd.tick(0);
    f.port.clear();
    uint32_t t = 0;
    for (int step = 1; step <= 20; ++step)
    {
        t += 300;
        f.lcd.tick(t);
    }
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL_STRING(" Display smoke t", payload(w.back()).c_str());
    f.port.clear();
    f.lcd.tick(t + 300);
    TEST_ASSERT_EQUAL_STRING("Display smoke te", payload(f.port.writes_to(LCD).back()).c_str());
}

// A marquee can live in part of a row: from column 6 the window is 10 wide and every redraw starts at 0xC6.
void test_scroll_window_starts_at_cursor_column()
{
    Fixture f;
    f.lcd.set_cursor(6, 1);
    f.port.clear();
    f.lcd.print("0123456789ABCDEF", Overflow::Scroll);
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0xC6}));
    TEST_ASSERT_EQUAL_STRING("0123456789", payload(w[1]).c_str());
    f.lcd.tick(0);
    f.port.clear();
    f.lcd.tick(300);
    w = f.port.writes_to(LCD);
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0xC6}));
    TEST_ASSERT_EQUAL_STRING("123456789A", payload(w[1]).c_str());
}

// set_scroll_interval() changes the step period.
void test_custom_scroll_interval()
{
    Fixture f;
    f.lcd.set_scroll_interval(100);
    f.lcd.print(LONG_TEXT, Overflow::Scroll);
    f.lcd.tick(0);
    f.port.clear();
    f.lcd.tick(99);
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    f.lcd.tick(100);
    TEST_ASSERT_EQUAL(2, f.port.write_count());
}

// Both rows can scroll different texts; one tick redraws each active row in turn.
void test_rows_scroll_independently()
{
    Fixture f;
    f.lcd.print_at(0, 0, "Row zero is a long line", Overflow::Scroll);
    f.lcd.print_at(0, 1, LONG_TEXT, Overflow::Scroll);
    f.lcd.tick(0);
    f.port.clear();
    f.lcd.tick(300);
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(4, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0x80}));
    TEST_ASSERT_EQUAL_STRING("ow zero is a lon", payload(w[1]).c_str());
    TEST_ASSERT_TRUE(bytes_equal(w[2], {0x80, 0xC0}));
    TEST_ASSERT_EQUAL_STRING("isplay smoke tes", payload(w[3]).c_str());
}

// The scroll buffer holds 64 chars; 65 is InvalidArgument with zero writes, 64 is accepted.
void test_scroll_text_over_buffer_is_rejected_before_writing()
{
    Fixture f;
    std::string tooLong(65, 'a');
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.print(tooLong.c_str(), Overflow::Scroll));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    std::string maxLen(64, 'a');
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print(maxLen.c_str(), Overflow::Scroll));
}

// A Truncate print on a scrolling row replaces it: stop the marquee, blank its window, move back, write the text.
void test_truncate_on_scrolling_row_stops_it_blanks_window_and_writes()
{
    Fixture f;
    f.lcd.print_at(0, 1, LONG_TEXT, Overflow::Scroll);
    f.lcd.tick(0);
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.set_cursor(3, 1));
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("x", Overflow::Truncate));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(4, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0xC0}));
    TEST_ASSERT_EQUAL(17, w[1].size());
    TEST_ASSERT_EQUAL_STRING("                ", payload(w[1]).c_str());
    TEST_ASSERT_TRUE(bytes_equal(w[2], {0x80, 0xC3}));
    TEST_ASSERT_EQUAL_STRING("x", payload(w[3]).c_str());
    f.port.clear();
    f.lcd.tick(300);
    f.lcd.tick(600);
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

// Only the window the marquee used is blanked, not the whole row.
void test_release_blanks_only_the_marquee_window()
{
    Fixture f;
    f.lcd.print_at(6, 1, "0123456789ABCDEF", Overflow::Scroll);
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print_at(0, 1, "ab"));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(4, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0xC6}));
    TEST_ASSERT_EQUAL_STRING("          ", payload(w[1]).c_str());
    TEST_ASSERT_TRUE(bytes_equal(w[2], {0x80, 0xC0}));
    TEST_ASSERT_EQUAL_STRING("ab", payload(w[3]).c_str());
}

// Wrap that spills onto a scrolling row 1 releases row 1 BEFORE writing row 0, so the display is never half-updated.
void test_wrap_into_scrolling_row1_releases_it_first()
{
    Fixture f;
    f.lcd.print_at(0, 1, LONG_TEXT, Overflow::Scroll);
    f.lcd.set_cursor(0, 0);
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("ABCDEFGHIJKLMNOPQRST", Overflow::Wrap));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(6, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0xC0}));            // release row 1
    TEST_ASSERT_EQUAL_STRING("                ", payload(w[1]).c_str());
    TEST_ASSERT_TRUE(bytes_equal(w[2], {0x80, 0x80}));            // back to (0,0)
    TEST_ASSERT_EQUAL_STRING("ABCDEFGHIJKLMNOP", payload(w[3]).c_str());
    TEST_ASSERT_TRUE(bytes_equal(w[4], {0x80, 0xC0}));
    TEST_ASSERT_EQUAL_STRING("QRST", payload(w[5]).c_str());
}

// A Wrap print that does not spill leaves a marquee on row 1 alone.
void test_wrap_that_fits_leaves_scrolling_row1_alone()
{
    Fixture f;
    f.lcd.print_at(0, 1, LONG_TEXT, Overflow::Scroll);
    f.lcd.tick(0);
    f.lcd.set_cursor(0, 0);
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("fits", Overflow::Wrap));
    TEST_ASSERT_EQUAL(1, f.port.write_count());
    f.port.clear();
    f.lcd.tick(300);
    TEST_ASSERT_EQUAL(2, f.port.write_count());
}

// Scroll onto a scrolling row replaces the marquee: old window blanked, new text drawn from offset 0.
void test_scroll_on_scrolling_row_replaces_text()
{
    Fixture f;
    f.lcd.print(LONG_TEXT, Overflow::Scroll);
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print_at(0, 0, "Another long text here", Overflow::Scroll));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(5, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0x80}));
    TEST_ASSERT_EQUAL_STRING("                ", payload(w[1]).c_str());
    TEST_ASSERT_EQUAL_STRING("Another long tex", payload(w[4]).c_str());
}

// stop_scroll() leaves the visible slice on screen, stops further ticks and allows normal prints again.
void test_stop_scroll_freezes_and_unprotects()
{
    Fixture f;
    f.lcd.print(LONG_TEXT, Overflow::Scroll);
    f.lcd.tick(0);
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.stop_scroll(0));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    f.lcd.tick(300);
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print_at(0, 0, "x", Overflow::Truncate));
}

// Stopping a row that does not scroll is harmless; row 2 does not exist.
void test_stop_scroll_on_idle_row_is_ok_and_out_of_range_is_invalid()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.stop_scroll(1));
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.stop_scroll(2));
}

// clear_row() stops one marquee, clear() stops both; neither needs a print to do it.
void test_clear_row_and_clear_stop_scrolling()
{
    Fixture f;
    f.lcd.print_at(0, 0, LONG_TEXT, Overflow::Scroll);
    f.lcd.print_at(0, 1, LONG_TEXT, Overflow::Scroll);
    f.lcd.tick(0);
    f.lcd.clear_row(0);
    f.port.clear();
    f.lcd.tick(300);
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(2, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0xC0}));
    f.lcd.clear();
    f.port.clear();
    f.lcd.tick(600);
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

// tick() is void: a failed redraw is dropped and the next step draws again.
void test_tick_ignores_i2c_failure_and_retries_next_step()
{
    Fixture f;
    f.lcd.print(LONG_TEXT, Overflow::Scroll);
    f.lcd.tick(0);
    f.port.clear();
    f.port.fail_next(1);
    f.lcd.tick(300);
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    f.lcd.tick(600);
    TEST_ASSERT_EQUAL(2, f.port.write_count());
}

// now_ms is uint32 and wraps after ~49 days; the interval check must use unsigned subtraction.
void test_tick_handles_time_wraparound()
{
    Fixture f;
    f.lcd.print(LONG_TEXT, Overflow::Scroll);
    f.lcd.tick(0xFFFFFF00u);
    f.port.clear();
    f.lcd.tick(0x00000100u);
    TEST_ASSERT_EQUAL(2, f.port.write_count());
}

// With no columns left there is nothing to scroll: no marquee is started and the row is not protected.
void test_scroll_on_full_row_writes_nothing_and_does_not_protect_row()
{
    Fixture f;
    f.lcd.print("ABCDEFGHIJKLMNOP");
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("more text here", Overflow::Scroll));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    f.lcd.tick(0);
    f.lcd.tick(1000);
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print_at(0, 0, "x", Overflow::Truncate));
}

// print_at() releases the marquee before its own cursor command, so there is exactly one positioning write for the text.
void test_print_at_on_scrolling_row_releases_then_positions_once()
{
    Fixture f;
    f.lcd.print_at(0, 1, LONG_TEXT, Overflow::Scroll);
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print_at(2, 1, "x", Overflow::Truncate));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(4, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0xC0}));
    TEST_ASSERT_EQUAL(17, w[1].size());
    TEST_ASSERT_TRUE(bytes_equal(w[2], {0x80, 0xC2}));
    TEST_ASSERT_EQUAL_STRING("x", payload(w[3]).c_str());
}

// Validation still happens before any write: a rejected print_at() on a scrolling row leaves the marquee running.
void test_print_at_invalid_on_scrolling_row_writes_nothing_and_keeps_marquee()
{
    Fixture f;
    f.lcd.print_at(0, 1, LONG_TEXT, Overflow::Scroll);
    f.lcd.tick(0);
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.print_at(2, 1, nullptr));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
    f.lcd.tick(300);
    TEST_ASSERT_EQUAL(2, f.port.write_count());
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_scroll_text_that_fits_is_written_once_and_never_scrolls);
    RUN_TEST(test_scroll_draws_offset_zero_immediately);
    RUN_TEST(test_first_tick_primes_then_steps_after_interval);
    RUN_TEST(test_scroll_wraps_around_with_three_space_padding);
    RUN_TEST(test_scroll_window_starts_at_cursor_column);
    RUN_TEST(test_custom_scroll_interval);
    RUN_TEST(test_rows_scroll_independently);
    RUN_TEST(test_scroll_text_over_buffer_is_rejected_before_writing);
    RUN_TEST(test_truncate_on_scrolling_row_stops_it_blanks_window_and_writes);
    RUN_TEST(test_release_blanks_only_the_marquee_window);
    RUN_TEST(test_wrap_into_scrolling_row1_releases_it_first);
    RUN_TEST(test_wrap_that_fits_leaves_scrolling_row1_alone);
    RUN_TEST(test_scroll_on_scrolling_row_replaces_text);
    RUN_TEST(test_stop_scroll_freezes_and_unprotects);
    RUN_TEST(test_stop_scroll_on_idle_row_is_ok_and_out_of_range_is_invalid);
    RUN_TEST(test_clear_row_and_clear_stop_scrolling);
    RUN_TEST(test_tick_ignores_i2c_failure_and_retries_next_step);
    RUN_TEST(test_tick_handles_time_wraparound);
    RUN_TEST(test_scroll_on_full_row_writes_nothing_and_does_not_protect_row);
    RUN_TEST(test_print_at_on_scrolling_row_releases_then_positions_once);
    RUN_TEST(test_print_at_invalid_on_scrolling_row_writes_nothing_and_keeps_marquee);
    return UNITY_END();
}
