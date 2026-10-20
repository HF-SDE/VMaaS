/**
 * @file test_main.cpp
 * @brief Host tests for detect_lcd(), which picks Grove or PCF8574 at boot.
 *
 * Detection only probes (address byte, no data), so a display that is not
 * there never receives a stray command. Order: Grove 0x3E, then the PCF8574
 * backpack at 0x27, then the PCF8574A at 0x3F; the first that answers wins.
 */
#include <unity.h>
#include <cstring>
#include "../fake_port.h"
#include "lcd_detect.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

// With Grove present it wins, and nothing after 0x3E is even probed.
void test_grove_first()
{
    FakePort port;
    const DetectedLcd d = detect_lcd(port);
    TEST_ASSERT_EQUAL(LcdKind::Grove, d.kind);
    TEST_ASSERT_EQUAL_HEX8(0x3E, d.addr);
    TEST_ASSERT_EQUAL(1, port.probes.size());
}

// No Grove: the PCF8574 at 0x27 is chosen.
void test_pcf8574_at_0x27()
{
    FakePort port;
    port.nak(0x3E);
    const DetectedLcd d = detect_lcd(port);
    TEST_ASSERT_EQUAL(LcdKind::Pcf8574, d.kind);
    TEST_ASSERT_EQUAL_HEX8(0x27, d.addr);
}

// No Grove and no 0x27: the PCF8574A at 0x3F is chosen.
void test_pcf8574a_at_0x3f()
{
    FakePort port;
    port.nak(0x3E);
    port.nak(0x27);
    const DetectedLcd d = detect_lcd(port);
    TEST_ASSERT_EQUAL(LcdKind::Pcf8574, d.kind);
    TEST_ASSERT_EQUAL_HEX8(0x3F, d.addr);
}

// Nothing answers: None, after probing exactly 0x3E, 0x27, 0x3F in that order and writing nothing.
void test_nothing_found_probes_in_order_and_writes_nothing()
{
    FakePort port;
    port.nak(0x3E);
    port.nak(0x27);
    port.nak(0x3F);
    const DetectedLcd d = detect_lcd(port);
    TEST_ASSERT_EQUAL(LcdKind::None, d.kind);
    TEST_ASSERT_EQUAL(3, port.probes.size());
    TEST_ASSERT_EQUAL_HEX8(0x3E, port.probes[0]);
    TEST_ASSERT_EQUAL_HEX8(0x27, port.probes[1]);
    TEST_ASSERT_EQUAL_HEX8(0x3F, port.probes[2]);
    TEST_ASSERT_EQUAL(0, port.events.size());
}

// to_string() gives log-friendly names.
void test_kind_names()
{
    TEST_ASSERT_EQUAL_STRING("None", to_string(LcdKind::None));
    TEST_ASSERT_EQUAL_STRING("Grove-LCD RGB", to_string(LcdKind::Grove));
    TEST_ASSERT_EQUAL_STRING("PCF8574 1602", to_string(LcdKind::Pcf8574));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_grove_first);
    RUN_TEST(test_pcf8574_at_0x27);
    RUN_TEST(test_pcf8574a_at_0x3f);
    RUN_TEST(test_nothing_found_probes_in_order_and_writes_nothing);
    RUN_TEST(test_kind_names);
    return UNITY_END();
}
