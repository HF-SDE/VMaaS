#include <unity.h>
#include <cstring>
#include "slot_config.h"
#include "slot_config_parser.h"
#include "slot_config_writer.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

namespace
{
    SlotConfig two_slots()
    {
        SlotConfig c{};
        c.steps_per_vend = 6400;
        c.slot_count = 2;
        c.slots[0] = SlotEntry{1, 1, {18, 0, 0, 0, 0, 0}};
        c.slots[1] = SlotEntry{3, 2, {21, 22, 0, 0, 0, 0}};
        return c;
    }
}

void test_writes_exactly_the_v2_shape()
{
    char out[256];
    const int n = write_slot_config_json(two_slots(), out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING(R"({"version":2,"motor":{"stepsPerVend":6400},"slots":[{"slot":1,"pins":[18]},{"slot":3,"pins":[21,22]}]})", out);
    TEST_ASSERT_EQUAL_INT((int)std::strlen(out), n);
}

void test_round_trips_through_the_parser()
{
    char out[256];
    write_slot_config_json(two_slots(), out, sizeof(out));
    const SlotParseResult r = parse_slot_config(out);
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT16(6400, r.config.steps_per_vend);
    TEST_ASSERT_EQUAL_UINT32(2, r.config.slot_count);
    TEST_ASSERT_EQUAL_UINT8(3, r.config.slots[1].slot);
    TEST_ASSERT_EQUAL_UINT8(2, r.config.slots[1].pin_count);
    TEST_ASSERT_EQUAL_UINT8(22, r.config.slots[1].pins[1]);
}

// 32 slots x 6 pins is the biggest table; it must fit Motorcontrol's 2048-byte file bound.
void test_largest_table_fits_max_config_bytes()
{
    SlotConfig c{};
    c.steps_per_vend = 65535;
    c.slot_count = MAX_SLOTS;
    for (size_t i = 0; i < MAX_SLOTS; ++i)
    {
        c.slots[i].slot = static_cast<uint8_t>(i + 1);
        c.slots[i].pin_count = MAX_PINS_PER_SLOT;
        for (size_t k = 0; k < MAX_PINS_PER_SLOT; ++k) c.slots[i].pins[k] = 33;
    }
    char out[2048];
    const int n = write_slot_config_json(c, out, sizeof(out));
    TEST_ASSERT_TRUE(n > 0);
    TEST_ASSERT_TRUE(n < 2048);
}

void test_too_small_buffer_returns_minus_one_and_empty_string()
{
    char out[40];
    TEST_ASSERT_EQUAL_INT(-1, write_slot_config_json(two_slots(), out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("", out);
}

void test_empty_table_still_writes_valid_json()
{
    SlotConfig c{};
    c.steps_per_vend = 1;
    char out[128];
    write_slot_config_json(c, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING(R"({"version":2,"motor":{"stepsPerVend":1},"slots":[]})", out);
}

// The stager accepts anything that fits a frame; the writer->parser round trip
// is what rejects a table the file format forbids. These are the cases.
void test_round_trip_rejects_what_the_stager_lets_through()
{
    char out[256];
    const auto rejects = [&](SlotConfig c) {
        write_slot_config_json(c, out, sizeof(out));
        return !parse_slot_config(out).ok;
    };
    SlotConfig base{};
    base.steps_per_vend = 6400;
    base.slot_count = 1;
    base.slots[0] = SlotEntry{1, 1, {18, 0, 0, 0, 0, 0}};

    SlotConfig zero_slot = base;   zero_slot.slots[0].slot = 0;
    SlotConfig no_pins = base;     no_pins.slots[0].pin_count = 0;
    SlotConfig input_only = base;  input_only.slots[0].pins[0] = 34;
    SlotConfig empty = base;       empty.slot_count = 0;
    SlotConfig dup_slot = base;    dup_slot.slot_count = 2; dup_slot.slots[1] = SlotEntry{1, 1, {19, 0, 0, 0, 0, 0}};
    SlotConfig dup_pin = base;     dup_pin.slot_count = 2;  dup_pin.slots[1] = SlotEntry{2, 1, {18, 0, 0, 0, 0, 0}};

    TEST_ASSERT_TRUE(rejects(zero_slot));
    TEST_ASSERT_TRUE(rejects(no_pins));
    TEST_ASSERT_TRUE(rejects(input_only));
    TEST_ASSERT_TRUE(rejects(empty));
    TEST_ASSERT_TRUE(rejects(dup_slot));
    TEST_ASSERT_TRUE(rejects(dup_pin));
    TEST_ASSERT_FALSE(rejects(base));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_writes_exactly_the_v2_shape);
    RUN_TEST(test_round_trips_through_the_parser);
    RUN_TEST(test_largest_table_fits_max_config_bytes);
    RUN_TEST(test_too_small_buffer_returns_minus_one_and_empty_string);
    RUN_TEST(test_empty_table_still_writes_valid_json);
    RUN_TEST(test_round_trip_rejects_what_the_stager_lets_through);
    return UNITY_END();
}
