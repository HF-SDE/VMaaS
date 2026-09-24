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

void test_wiring_command_ids_and_error_codes_match_spec()
{
    TEST_ASSERT_EQUAL_HEX8(0x14, static_cast<uint8_t>(Cmd::WIRING_BEGIN));
    TEST_ASSERT_EQUAL_HEX8(0x15, static_cast<uint8_t>(Cmd::WIRING_SLOT));
    TEST_ASSERT_EQUAL_HEX8(0x16, static_cast<uint8_t>(Cmd::WIRING_COMMIT));
    TEST_ASSERT_EQUAL_UINT8(7, static_cast<uint8_t>(ErrorCode::WIRING_STATE));
    TEST_ASSERT_EQUAL_UINT8(8, static_cast<uint8_t>(ErrorCode::WIRING_FULL));
    TEST_ASSERT_EQUAL_UINT8(9, static_cast<uint8_t>(ErrorCode::WRITE_FAILED));
    TEST_ASSERT_EQUAL_UINT8(6, WIRING_MAX_PINS);
}

void test_builder_wiring_begin_has_no_payload()
{
    const Frame f = frames::wiring_begin();
    TEST_ASSERT_EQUAL(Cmd::WIRING_BEGIN, f.cmd);
    TEST_ASSERT_EQUAL_UINT8(0, f.len);
}

void test_builder_wiring_slot_lays_out_slot_count_pins()
{
    const uint8_t pins[] = {21, 22};
    const Frame f = frames::wiring_slot(3, pins, 2);
    TEST_ASSERT_EQUAL(Cmd::WIRING_SLOT, f.cmd);
    TEST_ASSERT_EQUAL_UINT8(4, f.len);
    TEST_ASSERT_EQUAL_UINT8(3, f.payload[0]);
    TEST_ASSERT_EQUAL_UINT8(2, f.payload[1]);
    TEST_ASSERT_EQUAL_UINT8(21, f.payload[2]);
    TEST_ASSERT_EQUAL_UINT8(22, f.payload[3]);
}

// Six pins fill the frame exactly; a seventh cannot be sent and is dropped.
void test_builder_wiring_slot_clamps_to_six_pins()
{
    const uint8_t pins[] = {0, 2, 5, 12, 13, 14, 15};
    const Frame f = frames::wiring_slot(1, pins, 7);
    TEST_ASSERT_EQUAL_UINT8(8, f.len);
    TEST_ASSERT_EQUAL_UINT8(6, f.payload[1]);
    TEST_ASSERT_EQUAL_UINT8(14, f.payload[7]);
}

void test_builder_wiring_commit_is_count_then_u16_le_steps()
{
    const Frame f = frames::wiring_commit(4, 6400); // 0x1900
    TEST_ASSERT_EQUAL(Cmd::WIRING_COMMIT, f.cmd);
    TEST_ASSERT_EQUAL_UINT8(3, f.len);
    TEST_ASSERT_EQUAL_UINT8(4, f.payload[0]);
    TEST_ASSERT_EQUAL_HEX8(0x00, f.payload[1]);
    TEST_ASSERT_EQUAL_HEX8(0x19, f.payload[2]);
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
    RUN_TEST(test_wiring_command_ids_and_error_codes_match_spec);
    RUN_TEST(test_builder_wiring_begin_has_no_payload);
    RUN_TEST(test_builder_wiring_slot_lays_out_slot_count_pins);
    RUN_TEST(test_builder_wiring_slot_clamps_to_six_pins);
    RUN_TEST(test_builder_wiring_commit_is_count_then_u16_le_steps);
    return UNITY_END();
}
