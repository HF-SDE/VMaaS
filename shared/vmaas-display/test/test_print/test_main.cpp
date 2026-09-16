/**
 * @file test_main.cpp
 * @brief Host tests for print() in Truncate and Wrap mode, and print_at().
 *
 * The 16x2 geometry is the point: text longer than the columns left on the
 * row must be cut (Truncate) or continued on row 1 and then cut (Wrap), and
 * only the cells the text covers may be written. payload() strips the 0x40
 * data control byte so assertions compare the visible characters directly.
 * Also covers argument validation before any I2C write and that a failed
 * write stops the sequence.
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

// Text goes out as a single transfer: 0x40 control byte followed by the characters.
void test_short_text_written_as_one_data_transfer()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("VMaaS"));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(1, w.size());
    TEST_ASSERT_EQUAL_HEX8(0x40, w[0][0]);
    TEST_ASSERT_EQUAL_STRING("VMaaS", payload(w[0]).c_str());
}

// nullptr is rejected before anything is written.
void test_nullptr_is_invalid_argument()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.print(nullptr));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

// An empty string is a valid no-op, not an error.
void test_empty_text_writes_nothing()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print(""));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

// 20 chars from column 0: only the first 16 are sent.
void test_truncate_cuts_at_column_16()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("ABCDEFGHIJKLMNOPQRST", Overflow::Truncate));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(1, w.size());
    TEST_ASSERT_EQUAL_STRING("ABCDEFGHIJKLMNOP", payload(w[0]).c_str());
}

// From column 11 only 5 columns remain; "25 kr,-" becomes "25 kr". This is how a UI updates one field without redrawing the label.
void test_truncate_respects_cursor_column()
{
    Fixture f;
    f.lcd.set_cursor(11, 1);
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("25 kr,-", Overflow::Truncate));
    TEST_ASSERT_EQUAL_STRING("25 kr", payload(f.port.writes_to(LCD)[0]).c_str());
}

// After a row is filled the cursor is "past the end"; a further Truncate print writes nothing rather than overwriting column 15.
void test_truncate_on_full_row_writes_nothing()
{
    Fixture f;
    f.lcd.print("ABCDEFGHIJKLMNOP");
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("X", Overflow::Truncate));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

// The driver tracks the cursor itself, so successive prints know how many columns are left.
void test_consecutive_prints_advance_cursor()
{
    Fixture f;
    f.lcd.print("Slot: ");
    f.lcd.print("3");
    f.lcd.print("XXXXXXXXXXXXXXXX");
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(3, w.size());
    TEST_ASSERT_EQUAL_STRING("XXXXXXXXX", payload(w[2]).c_str());
}

// Wrap is software wrap: 16 chars on row 0, an explicit cursor move to (0,1), then the rest. The controller's own 40-char DDRAM wrap is never relied on.
void test_wrap_from_row0_continues_on_row1()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("ABCDEFGHIJKLMNOPQRST", Overflow::Wrap));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(3, w.size());
    TEST_ASSERT_EQUAL_STRING("ABCDEFGHIJKLMNOP", payload(w[0]).c_str());
    TEST_ASSERT_TRUE(bytes_equal(w[1], {0x80, 0xC0}));
    TEST_ASSERT_EQUAL_STRING("QRST", payload(w[2]).c_str());
}

// There is no row 2; text beyond the 32 visible cells is dropped.
void test_wrap_drops_text_beyond_row1()
{
    Fixture f;
    std::string forty(40, 'z');
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print(forty.c_str(), Overflow::Wrap));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(3, w.size());
    TEST_ASSERT_EQUAL(16, payload(w[0]).size());
    TEST_ASSERT_EQUAL(16, payload(w[2]).size());
}

// Wrap on the last row has nowhere to continue, so it cuts.
void test_wrap_on_row1_behaves_like_truncate()
{
    Fixture f;
    f.lcd.set_cursor(0, 1);
    f.port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("ABCDEFGHIJKLMNOPQRST", Overflow::Wrap));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(1, w.size());
    TEST_ASSERT_EQUAL_STRING("ABCDEFGHIJKLMNOP", payload(w[0]).c_str());
}

// Wrap must not emit a cursor move to row 1 when nothing spills over.
void test_wrap_that_fits_does_not_touch_row1()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print("fits", Overflow::Wrap));
    TEST_ASSERT_EQUAL(1, f.port.write_count());
}

// print_at() is the everyday call: exactly one cursor command, then the data.
void test_print_at_sets_cursor_then_prints()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.print_at(11, 1, "25 kr"));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(2, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0xCB}));
    TEST_ASSERT_EQUAL_STRING("25 kr", payload(w[1]).c_str());
}

// Bad col/row is rejected before the cursor command is written.
void test_print_at_invalid_position()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.print_at(16, 0, "x"));
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.print_at(0, 2, "x"));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

// If the first data write fails, the row-1 continuation must not be attempted.
void test_i2c_failure_during_wrap_stops_and_reports()
{
    Fixture f;
    f.port.fail_next(1);
    TEST_ASSERT_EQUAL(LcdError::I2cWrite, f.lcd.print("ABCDEFGHIJKLMNOPQRST", Overflow::Wrap));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

// print_at() validates the text before writing the cursor, so a rejected call leaves the bus untouched.
void test_print_at_nullptr_writes_nothing()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.print_at(3, 1, nullptr));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_short_text_written_as_one_data_transfer);
    RUN_TEST(test_nullptr_is_invalid_argument);
    RUN_TEST(test_empty_text_writes_nothing);
    RUN_TEST(test_truncate_cuts_at_column_16);
    RUN_TEST(test_truncate_respects_cursor_column);
    RUN_TEST(test_truncate_on_full_row_writes_nothing);
    RUN_TEST(test_consecutive_prints_advance_cursor);
    RUN_TEST(test_wrap_from_row0_continues_on_row1);
    RUN_TEST(test_wrap_drops_text_beyond_row1);
    RUN_TEST(test_wrap_on_row1_behaves_like_truncate);
    RUN_TEST(test_wrap_that_fits_does_not_touch_row1);
    RUN_TEST(test_print_at_sets_cursor_then_prints);
    RUN_TEST(test_print_at_invalid_position);
    RUN_TEST(test_i2c_failure_during_wrap_stops_and_reports);
    RUN_TEST(test_print_at_nullptr_writes_nothing);
    return UNITY_END();
}
