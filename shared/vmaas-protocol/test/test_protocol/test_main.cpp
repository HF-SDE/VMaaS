#include <unity.h>
#include "protocol.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

void test_constants()
{
    TEST_ASSERT_EQUAL_HEX8(0xAA, FRAME_START);
    TEST_ASSERT_EQUAL_UINT8(8, MAX_PAYLOAD);
    TEST_ASSERT_EQUAL_UINT32(12, MAX_FRAME_SIZE);
}

void test_command_ids_match_spec()
{
    TEST_ASSERT_EQUAL_HEX8(0x10, static_cast<uint8_t>(Cmd::RUN));
    TEST_ASSERT_EQUAL_HEX8(0x11, static_cast<uint8_t>(Cmd::STOP));
    TEST_ASSERT_EQUAL_HEX8(0x12, static_cast<uint8_t>(Cmd::STATUS));
    TEST_ASSERT_EQUAL_HEX8(0x13, static_cast<uint8_t>(Cmd::CONFIG));
    TEST_ASSERT_EQUAL_HEX8(0x80, static_cast<uint8_t>(Cmd::ACK));
    TEST_ASSERT_EQUAL_HEX8(0x81, static_cast<uint8_t>(Cmd::NAK));
    TEST_ASSERT_EQUAL_HEX8(0x82, static_cast<uint8_t>(Cmd::DONE));
    TEST_ASSERT_EQUAL_HEX8(0x83, static_cast<uint8_t>(Cmd::STATUS_REPLY));
}

void test_is_reply()
{
    TEST_ASSERT_FALSE(is_reply(Cmd::RUN));
    TEST_ASSERT_FALSE(is_reply(Cmd::CONFIG));
    TEST_ASSERT_TRUE(is_reply(Cmd::ACK));
    TEST_ASSERT_TRUE(is_reply(Cmd::STATUS_REPLY));
}

void test_builder_run()
{
    Frame f = frames::run(3);
    TEST_ASSERT_EQUAL(Cmd::RUN, f.cmd);
    TEST_ASSERT_EQUAL_UINT8(1, f.len);
    TEST_ASSERT_EQUAL_UINT8(3, f.payload[0]);
}

void test_builder_stop_and_status_have_no_payload()
{
    TEST_ASSERT_EQUAL_UINT8(0, frames::stop().len);
    TEST_ASSERT_EQUAL_UINT8(0, frames::status().len);
}

void test_builder_config_is_little_endian()
{
    Frame f = frames::config(ConfigParam::RUN_TIME_MS, 0x01F4); // 500 ms
    TEST_ASSERT_EQUAL(Cmd::CONFIG, f.cmd);
    TEST_ASSERT_EQUAL_UINT8(3, f.len);
    TEST_ASSERT_EQUAL_UINT8(1, f.payload[0]);
    TEST_ASSERT_EQUAL_HEX8(0xF4, f.payload[1]);
    TEST_ASSERT_EQUAL_HEX8(0x01, f.payload[2]);
}

void test_builder_replies()
{
    Frame a = frames::ack(Cmd::RUN);
    TEST_ASSERT_EQUAL(Cmd::ACK, a.cmd);
    TEST_ASSERT_EQUAL_UINT8(1, a.len);
    TEST_ASSERT_EQUAL_HEX8(0x10, a.payload[0]);

    Frame n = frames::nak(Cmd::RUN, ErrorCode::UNKNOWN_SLOT);
    TEST_ASSERT_EQUAL(Cmd::NAK, n.cmd);
    TEST_ASSERT_EQUAL_UINT8(2, n.len);
    TEST_ASSERT_EQUAL_HEX8(0x10, n.payload[0]);
    TEST_ASSERT_EQUAL_UINT8(4, n.payload[1]);

    Frame d = frames::done(7);
    TEST_ASSERT_EQUAL(Cmd::DONE, d.cmd);
    TEST_ASSERT_EQUAL_UINT8(1, d.len);
    TEST_ASSERT_EQUAL_UINT8(7, d.payload[0]);

    Frame s = frames::status_reply(State::BUSY, 2);
    TEST_ASSERT_EQUAL(Cmd::STATUS_REPLY, s.cmd);
    TEST_ASSERT_EQUAL_UINT8(2, s.len);
    TEST_ASSERT_EQUAL_UINT8(1, s.payload[0]);
    TEST_ASSERT_EQUAL_UINT8(2, s.payload[1]);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_constants);
    RUN_TEST(test_command_ids_match_spec);
    RUN_TEST(test_is_reply);
    RUN_TEST(test_builder_run);
    RUN_TEST(test_builder_stop_and_status_have_no_payload);
    RUN_TEST(test_builder_config_is_little_endian);
    RUN_TEST(test_builder_replies);
    return UNITY_END();
}
