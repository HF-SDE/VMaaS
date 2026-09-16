/**
 * @file test_main.cpp
 * @brief Host tests for GroveLcdRgb::begin(), ready() and the not-initialised state.
 *
 * Verifies the power-up sequence byte for byte against the AiP31068L datasheet
 * (command bytes on 0x3E and the delays between them), the backlight chip
 * detection order (SGM31323 at 0x30 is probed before PCA9633 at 0x62) and
 * each chip's init/colour registers, and how begin() degrades: no backlight
 * chip, a backlight config write that fails, or a dead LCD.
 *
 * FakePort records every write and delay in order; nak(addr) makes an address
 * never acknowledge, fail_write_at(n) fails the n-th acknowledged write.
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
}

void setUp() {}
void tearDown() {}

// The datasheet sequence, including the waits: 50 ms, 0x28, 5 ms, 0x28, 1 ms, 0x0C, 0x01, 2 ms, 0x06, all on 0x3E.
void test_init_sequence_bytes_and_delays_in_order()
{
    FakePort port;
    port.nak(RGB_V5);
    GroveLcdRgb lcd(port);
    TEST_ASSERT_EQUAL(LcdError::None, lcd.begin());

    const Event& e0 = port.events[0];
    TEST_ASSERT_EQUAL(Event::Delay, e0.kind); TEST_ASSERT_EQUAL_UINT32(50, e0.ms);
    TEST_ASSERT_TRUE(bytes_equal(port.events[1].bytes, {0x80, 0x28}));
    TEST_ASSERT_EQUAL(Event::Delay, port.events[2].kind); TEST_ASSERT_EQUAL_UINT32(5, port.events[2].ms);
    TEST_ASSERT_TRUE(bytes_equal(port.events[3].bytes, {0x80, 0x28}));
    TEST_ASSERT_EQUAL(Event::Delay, port.events[4].kind); TEST_ASSERT_EQUAL_UINT32(1, port.events[4].ms);
    TEST_ASSERT_TRUE(bytes_equal(port.events[5].bytes, {0x80, 0x0C}));
    TEST_ASSERT_TRUE(bytes_equal(port.events[6].bytes, {0x80, 0x01}));
    TEST_ASSERT_EQUAL(Event::Delay, port.events[7].kind); TEST_ASSERT_EQUAL_UINT32(2, port.events[7].ms);
    TEST_ASSERT_TRUE(bytes_equal(port.events[8].bytes, {0x80, 0x06}));
    for (int i = 1; i <= 8; ++i)
        if (port.events[i].kind == Event::Write)
            TEST_ASSERT_EQUAL_HEX8(LCD, port.events[i].addr);
}

// On a v4.0 module the 0x30 probe NAKs; PCA9633 at 0x62 must then get MODE1/LEDOUT/MODE2 and white (R,G,B = 0x04,0x03,0x02).
void test_v4_rgb_init_and_white_after_v5_probe_fails()
{
    FakePort port;
    port.nak(RGB_V5);
    GroveLcdRgb lcd(port);
    TEST_ASSERT_EQUAL(LcdError::None, lcd.begin());

    TEST_ASSERT_EQUAL(0, port.writes_to(RGB_V5).size()); // NAKed writes are not recorded
    auto w = port.writes_to(RGB_V4);
    TEST_ASSERT_EQUAL(6, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x00, 0x00})); // MODE1
    TEST_ASSERT_TRUE(bytes_equal(w[1], {0x08, 0xFF})); // LEDOUT
    TEST_ASSERT_TRUE(bytes_equal(w[2], {0x01, 0x20})); // MODE2
    TEST_ASSERT_TRUE(bytes_equal(w[3], {0x04, 0xFF})); // red
    TEST_ASSERT_TRUE(bytes_equal(w[4], {0x03, 0xFF})); // green
    TEST_ASSERT_TRUE(bytes_equal(w[5], {0x02, 0xFF})); // blue
}

// When both chips answer, the v5.0 SGM31323 wins and only its registers are written.
void test_v5_rgb_detected_first()
{
    FakePort port;
    GroveLcdRgb lcd(port);
    TEST_ASSERT_EQUAL(LcdError::None, lcd.begin());

    TEST_ASSERT_EQUAL(0, port.writes_to(RGB_V4).size());
    auto w = port.writes_to(RGB_V5);
    TEST_ASSERT_EQUAL(5, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x00, 0x07}));
    TEST_ASSERT_TRUE(bytes_equal(w[1], {0x04, 0x15}));
    TEST_ASSERT_TRUE(bytes_equal(w[2], {0x06, 0xFF})); // red
    TEST_ASSERT_TRUE(bytes_equal(w[3], {0x07, 0xFF})); // green
    TEST_ASSERT_TRUE(bytes_equal(w[4], {0x08, 0xFF})); // blue
}

// Missing backlight chip is reported, but text calls still work; the LCD and the backlight are independent devices.
void test_no_rgb_chip_reports_error_but_lcd_is_usable()
{
    FakePort port;
    port.nak(RGB_V5);
    port.nak(RGB_V4);
    GroveLcdRgb lcd(port);
    TEST_ASSERT_EQUAL(LcdError::RgbChipNotFound, lcd.begin());
    TEST_ASSERT_EQUAL(LcdError::RgbChipNotFound, lcd.set_rgb(1, 2, 3));

    port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, lcd.set_cursor(0, 0));
    TEST_ASSERT_EQUAL(1, port.write_count());
}

// If the LCD itself never acknowledges, nothing else may pretend to work afterwards.
void test_lcd_write_failure_leaves_driver_uninitialised()
{
    FakePort port;
    port.nak(LCD);
    GroveLcdRgb lcd(port);
    TEST_ASSERT_EQUAL(LcdError::I2cWrite, lcd.begin());
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.set_cursor(0, 0));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.set_rgb(1, 2, 3));
}

// A backlight chip that acknowledges its probe but then NAKs a config write is an I2cWrite, not RgbChipNotFound, and the LCD stays usable.
void test_rgb_config_write_failure_returns_i2c_write_but_lcd_usable()
{
    FakePort port;
    port.nak(RGB_V5);
    port.fail_write_at(6);
    GroveLcdRgb lcd(port);
    TEST_ASSERT_EQUAL(LcdError::I2cWrite, lcd.begin());
    TEST_ASSERT_EQUAL(1, port.writes_to(RGB_V4).size());

    port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, lcd.set_cursor(0, 0));
}

// Every public call before begin() returns NotInitialized and does not touch the bus; tick() must be a no-op too.
void test_methods_before_begin_return_not_initialized()
{
    FakePort port;
    GroveLcdRgb lcd(port);
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.clear());
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.clear_row(0));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.set_cursor(0, 0));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.print("x"));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.print_at(0, 0, "x"));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.stop_scroll(0));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.set_rgb(0, 0, 0));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.display(true));
    lcd.tick(1000);
    TEST_ASSERT_EQUAL(0, port.write_count());
}

// ready() lets a caller tell "LCD dead" from "backlight problem" when begin() returns an error; Main-Controller gates text on it.
void test_ready_reflects_lcd_init_only()
{
    FakePort a; GroveLcdRgb lcd_a(a);
    TEST_ASSERT_FALSE(lcd_a.ready());
    lcd_a.begin();
    TEST_ASSERT_TRUE(lcd_a.ready());

    FakePort b; b.nak(RGB_V5); b.nak(RGB_V4); GroveLcdRgb lcd_b(b);
    TEST_ASSERT_EQUAL(LcdError::RgbChipNotFound, lcd_b.begin());
    TEST_ASSERT_TRUE(lcd_b.ready());

    FakePort c; c.nak(RGB_V5); c.fail_write_at(6); GroveLcdRgb lcd_c(c);
    TEST_ASSERT_EQUAL(LcdError::I2cWrite, lcd_c.begin());
    TEST_ASSERT_TRUE(lcd_c.ready());

    FakePort d; d.nak(LCD); GroveLcdRgb lcd_d(d);
    TEST_ASSERT_EQUAL(LcdError::I2cWrite, lcd_d.begin());
    TEST_ASSERT_FALSE(lcd_d.ready());
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_init_sequence_bytes_and_delays_in_order);
    RUN_TEST(test_v4_rgb_init_and_white_after_v5_probe_fails);
    RUN_TEST(test_v5_rgb_detected_first);
    RUN_TEST(test_no_rgb_chip_reports_error_but_lcd_is_usable);
    RUN_TEST(test_lcd_write_failure_leaves_driver_uninitialised);
    RUN_TEST(test_rgb_config_write_failure_returns_i2c_write_but_lcd_usable);
    RUN_TEST(test_methods_before_begin_return_not_initialized);
    RUN_TEST(test_ready_reflects_lcd_init_only);
    return UNITY_END();
}
