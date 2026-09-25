/**
 * @file test_main.cpp
 * @brief Host tests for one line of the event journal.
 */
#include <unity.h>
#include <cstdio>
#include <cstring>
#include "record.h"

using namespace vmaas::events;

void setUp() {}
void tearDown() {}

static Record sample()
{
    Record r{};
    r.seq = 42;
    r.uptime_ms = 915334;
    r.wall_ms = 1758456224000ULL;
    std::snprintf(r.type, sizeof(r.type), "door-released");
    std::snprintf(r.payload, sizeof(r.payload), "{\"source\":\"keypad\"}");
    return r;
}

void test_a_record_encodes_to_one_line()
{
    char line[MAX_LINE];
    TEST_ASSERT_TRUE(encode_record(sample(), line, sizeof(line)));
    TEST_ASSERT_EQUAL_STRING("42|915334|1758456224000|door-released|{\"source\":\"keypad\"}", line);
}

void test_a_record_survives_a_round_trip()
{
    char line[MAX_LINE];
    encode_record(sample(), line, sizeof(line));

    Record out{};
    TEST_ASSERT_TRUE(decode_record(line, out));
    TEST_ASSERT_EQUAL_UINT32(42, out.seq);
    TEST_ASSERT_EQUAL_UINT32(915334, out.uptime_ms);
    TEST_ASSERT_TRUE(out.wall_ms == 1758456224000ULL);
    TEST_ASSERT_EQUAL_STRING("door-released", out.type);
    TEST_ASSERT_EQUAL_STRING("{\"source\":\"keypad\"}", out.payload);
}

// The payload is opaque and may contain the delimiter.
void test_a_payload_containing_a_pipe_survives()
{
    Record r = sample();
    std::snprintf(r.payload, sizeof(r.payload), "{\"note\":\"a|b\"}");
    char line[MAX_LINE];
    encode_record(r, line, sizeof(line));

    Record out{};
    TEST_ASSERT_TRUE(decode_record(line, out));
    TEST_ASSERT_EQUAL_STRING("{\"note\":\"a|b\"}", out.payload);
}

// A truncated tail is what a power cut during a write leaves behind.
void test_a_truncated_line_is_refused()
{
    Record out{};
    TEST_ASSERT_FALSE(decode_record("42|915334|17584", out));
}

void test_a_line_with_a_non_numeric_sequence_is_refused()
{
    Record out{};
    TEST_ASSERT_FALSE(decode_record("x|1|2|door-released|{}", out));
}

void test_an_empty_line_is_refused()
{
    Record out{};
    TEST_ASSERT_FALSE(decode_record("", out));
}

// A wall clock of 0 means "unknown", and must survive as 0 rather than as a date.
void test_an_unknown_clock_round_trips_as_zero()
{
    Record r = sample();
    r.wall_ms = 0;
    char line[MAX_LINE];
    encode_record(r, line, sizeof(line));

    Record out{};
    TEST_ASSERT_TRUE(decode_record(line, out));
    TEST_ASSERT_TRUE(out.wall_ms == 0);
}

void test_encoding_refuses_a_payload_with_a_newline()
{
    Record r = sample();
    std::snprintf(r.payload, sizeof(r.payload), "{\"a\":\"b\n\"}");
    char line[MAX_LINE];
    TEST_ASSERT_FALSE(encode_record(r, line, sizeof(line)));
}

void test_encoding_refuses_a_buffer_that_is_too_small()
{
    char line[8];
    TEST_ASSERT_FALSE(encode_record(sample(), line, sizeof(line)));
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_a_record_encodes_to_one_line);
    RUN_TEST(test_a_record_survives_a_round_trip);
    RUN_TEST(test_a_payload_containing_a_pipe_survives);
    RUN_TEST(test_a_truncated_line_is_refused);
    RUN_TEST(test_a_line_with_a_non_numeric_sequence_is_refused);
    RUN_TEST(test_an_empty_line_is_refused);
    RUN_TEST(test_an_unknown_clock_round_trips_as_zero);
    RUN_TEST(test_encoding_refuses_a_payload_with_a_newline);
    RUN_TEST(test_encoding_refuses_a_buffer_that_is_too_small);
    return UNITY_END();
}
