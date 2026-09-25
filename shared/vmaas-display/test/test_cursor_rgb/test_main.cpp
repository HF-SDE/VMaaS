/**
 * @file test_main.cpp
 * @brief Host tests for set_cursor(), clear(), clear_row(), display() and set_rgb().
 *
 * Each test starts from a begun v4.0 display (Fixture) with the event log
 * cleared, so the assertions see only the bytes the call under test produced.
 * Checks DDRAM addressing (row 0 = 0x80|col, row 1 = 0xC0|col), the 2 ms wait
 * after Clear Display, the 16-space row blank, display on/off commands, the
 * per-chip colour registers, argument validation and I2C error propagation.
 */
#include <unity.h>
#include "../fake_port.h"
#include "grove_lcd_rgb.h"

using namespace vmaas;

namespace
{
    constexpr uint8_t LCD = 0x3E;
    constexpr uint8_t RGB_V4 = 0x62;
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
}

void setUp() {}
void tearDown() {}

// Row 0 uses DDRAM address 0x00, sent as Set DDRAM Address 0x80|0x00.
void test_set_cursor_row0_col0()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.set_cursor(0, 0));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(1, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0x80}));
}

// Row 1 starts at DDRAM 0x40, so (5,1) becomes 0x80|0x45 = 0xC5.
void test_set_cursor_row1_col5()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.set_cursor(5, 1));
    TEST_ASSERT_TRUE(bytes_equal(f.port.writes_to(LCD)[0], {0x80, 0xC5}));
}

// Validation happens before any I2C write; an off-screen cursor is never sent to the controller.
void test_set_cursor_out_of_range_writes_nothing()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.set_cursor(16, 0));
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.set_cursor(0, 2));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

// A NAK on the cursor command surfaces as I2cWrite.
void test_set_cursor_i2c_failure()
{
    Fixture f;
    f.port.fail_next(1);
    TEST_ASSERT_EQUAL(LcdError::I2cWrite, f.lcd.set_cursor(3, 0));
}

// Clear Display (0x01) needs ~1.5 ms in the controller; the driver must wait 2 ms before the next command.
void test_clear_sends_clear_and_waits()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.clear());
    TEST_ASSERT_EQUAL(2, f.port.events.size());
    TEST_ASSERT_TRUE(bytes_equal(f.port.events[0].bytes, {0x80, 0x01}));
    TEST_ASSERT_EQUAL(Event::Delay, f.port.events[1].kind);
    TEST_ASSERT_EQUAL_UINT32(2, f.port.events[1].ms);
}

// clear_row() blanks one row without the full-display flicker of clear(): cursor to column 0, then 16 spaces in one data transfer.
void test_clear_row_writes_16_spaces_at_row_start()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.clear_row(1));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_EQUAL(2, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0xC0}));
    TEST_ASSERT_EQUAL(17, w[1].size());
    TEST_ASSERT_EQUAL_HEX8(0x40, w[1][0]);
    for (size_t i = 1; i < 17; ++i)
        TEST_ASSERT_EQUAL_HEX8(' ', w[1][i]);
}

// Only rows 0 and 1 exist.
void test_clear_row_out_of_range()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::InvalidArgument, f.lcd.clear_row(2));
    TEST_ASSERT_EQUAL(0, f.port.write_count());
}

// display(false/true) sends Display Control 0x08/0x0C; the backlight is a separate chip and is not touched.
void test_display_on_off()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.display(false));
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.display(true));
    auto w = f.port.writes_to(LCD);
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x80, 0x08}));
    TEST_ASSERT_TRUE(bytes_equal(w[1], {0x80, 0x0C}));
}

// PCA9633 colour registers are in reverse order: red 0x04, green 0x03, blue 0x02. Nothing goes to the LCD address.
void test_set_rgb_v4_registers()
{
    Fixture f;
    TEST_ASSERT_EQUAL(LcdError::None, f.lcd.set_rgb(10, 20, 30));
    auto w = f.port.writes_to(RGB_V4);
    TEST_ASSERT_EQUAL(3, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x04, 10}));
    TEST_ASSERT_TRUE(bytes_equal(w[1], {0x03, 20}));
    TEST_ASSERT_TRUE(bytes_equal(w[2], {0x02, 30}));
    TEST_ASSERT_EQUAL(0, f.port.writes_to(LCD).size());
}

// SGM31323 uses red 0x06, green 0x07, blue 0x08.
void test_set_rgb_v5_registers()
{
    FakePort port;
    GroveLcdRgb lcd(port);
    lcd.begin();
    port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, lcd.set_rgb(10, 20, 30));
    auto w = port.writes_to(RGB_V5);
    TEST_ASSERT_EQUAL(3, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x06, 10}));
    TEST_ASSERT_TRUE(bytes_equal(w[1], {0x07, 20}));
    TEST_ASSERT_TRUE(bytes_equal(w[2], {0x08, 30}));
}

// A failing colour write is reported, not swallowed.
void test_set_rgb_i2c_failure()
{
    Fixture f;
    f.port.fail_next(1);
    TEST_ASSERT_EQUAL(LcdError::I2cWrite, f.lcd.set_rgb(1, 2, 3));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_set_cursor_row0_col0);
    RUN_TEST(test_set_cursor_row1_col5);
    RUN_TEST(test_set_cursor_out_of_range_writes_nothing);
    RUN_TEST(test_set_cursor_i2c_failure);
    RUN_TEST(test_clear_sends_clear_and_waits);
    RUN_TEST(test_clear_row_writes_16_spaces_at_row_start);
    RUN_TEST(test_clear_row_out_of_range);
    RUN_TEST(test_display_on_off);
    RUN_TEST(test_set_rgb_v4_registers);
    RUN_TEST(test_set_rgb_v5_registers);
    RUN_TEST(test_set_rgb_i2c_failure);
    return UNITY_END();
}
