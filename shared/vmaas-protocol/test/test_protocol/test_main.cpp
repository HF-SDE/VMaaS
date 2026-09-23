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

// CONFIG has no parameters since stepsPerVend moved into config.json, but the
// opcode and its wire layout (param u8, value u16) are kept so a stale
// Main-Controller gets a well-formed NAK BAD_PARAM rather than UNKNOWN_CMD.
void test_config_opcode_is_reserved_with_no_params()
{
    TEST_ASSERT_EQUAL_HEX8(0x13, static_cast<uint8_t>(Cmd::CONFIG));
    TEST_ASSERT_EQUAL_UINT8(5, static_cast<uint8_t>(ErrorCode::BAD_PARAM));
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

// Motorcontrol without a valid slot configuration refuses requests with
// CONFIG_ERROR (code 6) and reports State::ERROR in STATUS_REPLY.
void test_config_error_code_and_error_state_match_spec()
{
    TEST_ASSERT_EQUAL_UINT8(6, static_cast<uint8_t>(ErrorCode::CONFIG_ERROR));

    Frame n = frames::nak(Cmd::RUN, ErrorCode::CONFIG_ERROR);
    TEST_ASSERT_EQUAL(Cmd::NAK, n.cmd);
    TEST_ASSERT_EQUAL_UINT8(2, n.len);
    TEST_ASSERT_EQUAL_HEX8(0x10, n.payload[0]);
    TEST_ASSERT_EQUAL_UINT8(6, n.payload[1]);

    Frame s = frames::status_reply(State::ERROR, 0);
    TEST_ASSERT_EQUAL_UINT8(2, s.payload[0]);
    TEST_ASSERT_EQUAL_UINT8(0, s.payload[1]);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_config_error_code_and_error_state_match_spec);
    RUN_TEST(test_constants);
    RUN_TEST(test_command_ids_match_spec);
    RUN_TEST(test_is_reply);
    RUN_TEST(test_builder_run);
    RUN_TEST(test_builder_stop_and_status_have_no_payload);
    RUN_TEST(test_config_opcode_is_reserved_with_no_params);
    RUN_TEST(test_builder_replies);
    return UNITY_END();
}
