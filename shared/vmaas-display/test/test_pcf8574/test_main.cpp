/**
 * @file test_main.cpp
 * @brief Host tests for Pcf8574Lcd, the 1602A behind a PCF8574 I2C backpack.
 *
 * The backpack wires P0=RS, P1=RW, P2=EN, P3=backlight, P4-P7=D4-D7, so every
 * HD44780 byte goes out as two nibbles, each one a three-byte EN pulse:
 * data, data|EN, data. The tests check those bytes, that the backlight bit
 * rides along in every one of them, and that the text/scroll logic shared
 * with GroveLcdRgb works through this backend unchanged.
 */
#include <unity.h>
#include <cstring>
#include "../fake_port.h"
#include "pcf8574_lcd.h"

using namespace vmaas;

namespace
{
    constexpr uint8_t ADDR = 0x27;
    constexpr uint8_t RS = 0x01, EN = 0x04, BL = 0x08;

    // The six bytes one HD44780 byte becomes: high nibble, then low nibble.
    std::vector<uint8_t> hd_byte(uint8_t value, uint8_t flags)
    {
        const uint8_t hi = static_cast<uint8_t>((value & 0xF0) | flags);
        const uint8_t lo = static_cast<uint8_t>(((value << 4) & 0xF0) | flags);
        return {hi, static_cast<uint8_t>(hi | EN), hi, lo, static_cast<uint8_t>(lo | EN), lo};
    }

    std::vector<uint8_t> hd_text(const char* text, uint8_t flags)
    {
        std::vector<uint8_t> out;
        for (; *text; ++text)
        {
            const auto b = hd_byte(static_cast<uint8_t>(*text), flags);
            out.insert(out.end(), b.begin(), b.end());
        }
        return out;
    }

    void started(FakePort& port, Pcf8574Lcd& lcd)
    {
        TEST_ASSERT_EQUAL(LcdError::None, lcd.begin(ADDR));
        port.clear();
    }
}

void setUp() {}
void tearDown() {}

// HD44780 fig. 24 in 4-bit mode: 50 ms, nibble 3 x3 (5 ms, 1 ms between), nibble 2, then 0x28 0x0C 0x01 (2 ms) 0x06, backlight on throughout.
void test_init_sequence_bytes_and_delays_in_order()
{
    FakePort port;
    Pcf8574Lcd lcd(port);
    TEST_ASSERT_EQUAL(LcdError::None, lcd.begin(ADDR));
    TEST_ASSERT_TRUE(lcd.ready());

    const auto& e = port.events;
    TEST_ASSERT_EQUAL(13, e.size());
    TEST_ASSERT_EQUAL(Event::Delay, e[0].kind); TEST_ASSERT_EQUAL_UINT32(50, e[0].ms);
    TEST_ASSERT_TRUE(bytes_equal(e[1].bytes, {0x38, 0x3C, 0x38}));
    TEST_ASSERT_EQUAL(Event::Delay, e[2].kind); TEST_ASSERT_EQUAL_UINT32(5, e[2].ms);
    TEST_ASSERT_TRUE(bytes_equal(e[3].bytes, {0x38, 0x3C, 0x38}));
    TEST_ASSERT_EQUAL(Event::Delay, e[4].kind); TEST_ASSERT_EQUAL_UINT32(1, e[4].ms);
    TEST_ASSERT_TRUE(bytes_equal(e[5].bytes, {0x38, 0x3C, 0x38}));
    TEST_ASSERT_EQUAL(Event::Delay, e[6].kind); TEST_ASSERT_EQUAL_UINT32(1, e[6].ms);
    TEST_ASSERT_TRUE(bytes_equal(e[7].bytes, {0x28, 0x2C, 0x28}));
    TEST_ASSERT_TRUE(bytes_equal(e[8].bytes, {0x28, 0x2C, 0x28, 0x88, 0x8C, 0x88}));  // 0x28
    TEST_ASSERT_TRUE(bytes_equal(e[9].bytes, {0x08, 0x0C, 0x08, 0xC8, 0xCC, 0xC8}));  // 0x0C
    TEST_ASSERT_TRUE(bytes_equal(e[10].bytes, {0x08, 0x0C, 0x08, 0x18, 0x1C, 0x18})); // 0x01
    TEST_ASSERT_EQUAL(Event::Delay, e[11].kind); TEST_ASSERT_EQUAL_UINT32(2, e[11].ms);
    TEST_ASSERT_TRUE(bytes_equal(e[12].bytes, {0x08, 0x0C, 0x08, 0x68, 0x6C, 0x68})); // 0x06
    for (const Event& ev : e) {
        if (ev.kind == Event::Write) {
            TEST_ASSERT_EQUAL_HEX8(ADDR, ev.addr);
        }
    }
}

// A PCF8574A backpack at 0x3F gets every byte at 0x3F.
void test_begin_uses_given_address()
{
    FakePort port;
    Pcf8574Lcd lcd(port);
    TEST_ASSERT_EQUAL(LcdError::None, lcd.begin(0x3F));
    TEST_ASSERT_TRUE(port.write_count() > 0);
    TEST_ASSERT_EQUAL(0, port.writes_to(ADDR).size());
    TEST_ASSERT_EQUAL(port.write_count(), port.writes_to(0x3F).size());
}

// A backpack that does not answer leaves the driver uninitialised after the first write.
void test_begin_nak_leaves_driver_uninitialised()
{
    FakePort port;
    port.nak(ADDR);
    Pcf8574Lcd lcd(port);
    TEST_ASSERT_EQUAL(LcdError::I2cWrite, lcd.begin(ADDR));
    TEST_ASSERT_FALSE(lcd.ready());
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.print_at(0, 0, "x"));
}

// Before begin() nothing is written and every call says NotInitialized.
void test_methods_before_begin_return_not_initialized()
{
    FakePort port;
    Pcf8574Lcd lcd(port);
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.set_rgb(255, 255, 255));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.print_at(0, 0, "x"));
    TEST_ASSERT_EQUAL(LcdError::NotInitialized, lcd.clear());
    TEST_ASSERT_EQUAL(0, port.write_count());
}

// print_at = one cursor command, then the whole text as a single write with RS set on every nibble.
void test_print_at_writes_cursor_then_text_in_one_write()
{
    FakePort port;
    Pcf8574Lcd lcd(port);
    started(port, lcd);

    TEST_ASSERT_EQUAL(LcdError::None, lcd.print_at(3, 1, "AB"));
    auto w = port.writes_to(ADDR);
    TEST_ASSERT_EQUAL(2, w.size());
    TEST_ASSERT_TRUE(w[0] == hd_byte(0xC3, BL)); // DDRAM 0x40 + 3
    TEST_ASSERT_TRUE(bytes_equal(w[1], {0x49, 0x4D, 0x49, 0x19, 0x1D, 0x19,     // 'A'
                                        0x49, 0x4D, 0x49, 0x29, 0x2D, 0x29}));  // 'B'
}

// Truncate is the shared column math: 20 chars from column 0 put 16 on the wire.
void test_truncate_cuts_at_column_16()
{
    FakePort port;
    Pcf8574Lcd lcd(port);
    started(port, lcd);

    TEST_ASSERT_EQUAL(LcdError::None, lcd.print_at(0, 0, "0123456789ABCDEFGHIJ"));
    auto w = port.writes_to(ADDR);
    TEST_ASSERT_EQUAL(2, w.size());
    TEST_ASSERT_TRUE(w[1] == hd_text("0123456789ABCDEF", RS | BL));
}

// set_rgb(0,0,0) turns the backlight off; any other colour turns it on. The bit sticks to later text.
void test_set_rgb_switches_backlight_bit()
{
    FakePort port;
    Pcf8574Lcd lcd(port);
    started(port, lcd);

    TEST_ASSERT_EQUAL(LcdError::None, lcd.set_rgb(0, 0, 0));
    TEST_ASSERT_EQUAL(LcdError::None, lcd.print_at(0, 0, "A"));
    TEST_ASSERT_EQUAL(LcdError::None, lcd.set_rgb(255, 0, 0));
    TEST_ASSERT_EQUAL(LcdError::None, lcd.print_at(0, 0, "A"));

    auto w = port.writes_to(ADDR);
    TEST_ASSERT_EQUAL(6, w.size());
    TEST_ASSERT_TRUE(bytes_equal(w[0], {0x00}));
    TEST_ASSERT_TRUE(w[1] == hd_byte(0x80, 0));
    TEST_ASSERT_TRUE(w[2] == hd_text("A", RS));
    TEST_ASSERT_TRUE(bytes_equal(w[3], {BL}));
    TEST_ASSERT_TRUE(w[4] == hd_byte(0x80, BL));
    TEST_ASSERT_TRUE(w[5] == hd_text("A", RS | BL));
}

// Every set_rgb colour the firmware uses (white, red, yellow, blue, green) means "on".
void test_any_colour_means_on()
{
    FakePort port;
    Pcf8574Lcd lcd(port);
    started(port, lcd);

    const uint8_t colours[][3] = {{255, 255, 255}, {255, 0, 0}, {255, 200, 0}, {0, 80, 255}, {0, 255, 0}, {0, 0, 1}};
    for (const auto& c : colours)
    {
        port.clear();
        TEST_ASSERT_EQUAL(LcdError::None, lcd.set_rgb(c[0], c[1], c[2]));
        TEST_ASSERT_TRUE(bytes_equal(port.writes_to(ADDR)[0], {BL}));
    }
}

// clear() sends 0x01 and waits the 2 ms the controller needs; display(false) sends 0x08.
void test_clear_and_display_commands()
{
    FakePort port;
    Pcf8574Lcd lcd(port);
    started(port, lcd);

    TEST_ASSERT_EQUAL(LcdError::None, lcd.clear());
    TEST_ASSERT_EQUAL(2, port.events.size());
    TEST_ASSERT_TRUE(port.events[0].bytes == hd_byte(0x01, BL));
    TEST_ASSERT_EQUAL(Event::Delay, port.events[1].kind); TEST_ASSERT_EQUAL_UINT32(2, port.events[1].ms);

    port.clear();
    TEST_ASSERT_EQUAL(LcdError::None, lcd.display(false));
    TEST_ASSERT_TRUE(port.writes_to(ADDR)[0] == hd_byte(0x08, BL));
}

// A marquee runs through this backend too: one step after the interval redraws the window from offset 1.
void test_scroll_steps_through_pcf_backend()
{
    FakePort port;
    Pcf8574Lcd lcd(port);
    started(port, lcd);

    TEST_ASSERT_EQUAL(LcdError::None, lcd.print_at(0, 1, "0123456789ABCDEFGH", Overflow::Scroll));
    port.clear();
    lcd.tick(1000);
    TEST_ASSERT_EQUAL(0, port.write_count());
    lcd.tick(1300);

    auto w = port.writes_to(ADDR);
    TEST_ASSERT_EQUAL(2, w.size());
    TEST_ASSERT_TRUE(w[0] == hd_byte(0xC0, BL));
    TEST_ASSERT_TRUE(w[1] == hd_text("123456789ABCDEFG", RS | BL));
}

// A failed write on the wire is reported as I2cWrite, like the Grove backend.
void test_write_failure_is_i2c_write()
{
    FakePort port;
    Pcf8574Lcd lcd(port);
    started(port, lcd);

    port.fail_next(1);
    TEST_ASSERT_EQUAL(LcdError::I2cWrite, lcd.print_at(0, 0, "A"));
    port.fail_next(1);
    TEST_ASSERT_EQUAL(LcdError::I2cWrite, lcd.set_rgb(0, 0, 0));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_init_sequence_bytes_and_delays_in_order);
    RUN_TEST(test_begin_uses_given_address);
    RUN_TEST(test_begin_nak_leaves_driver_uninitialised);
    RUN_TEST(test_methods_before_begin_return_not_initialized);
    RUN_TEST(test_print_at_writes_cursor_then_text_in_one_write);
    RUN_TEST(test_truncate_cuts_at_column_16);
    RUN_TEST(test_set_rgb_switches_backlight_bit);
    RUN_TEST(test_any_colour_means_on);
    RUN_TEST(test_clear_and_display_commands);
    RUN_TEST(test_scroll_steps_through_pcf_backend);
    RUN_TEST(test_write_failure_is_i2c_write);
    return UNITY_END();
}
