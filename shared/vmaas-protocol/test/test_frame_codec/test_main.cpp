#include <unity.h>
#include "frame_codec.h"
#include "crc8.h"

using namespace vmaas;

namespace
{
    // A CONFIG frame built by hand: the builder was removed with RUN_TIME_MS,
    // but the codec must still round-trip the 3-byte layout.
    Frame raw_config(uint8_t param, uint16_t value)
    {
        Frame f;
        f.cmd = Cmd::CONFIG;
        f.len = 3;
        f.payload[0] = param;
        f.payload[1] = static_cast<uint8_t>(value & 0xFF);
        f.payload[2] = static_cast<uint8_t>(value >> 8);
        return f;
    }
}

void setUp() {}
void tearDown() {}

// ---------- encode ----------

void test_encode_run_slot_3_matches_protocol_md()
{
    uint8_t out[MAX_FRAME_SIZE] = {};
    size_t n = encode(frames::run(3), out, sizeof(out));
    const uint8_t expected[] = {0xAA, 0x01, 0x10, 0x03, 0x35};
    TEST_ASSERT_EQUAL_UINT32(5, n);
    TEST_ASSERT_EQUAL_HEX8_ARRAY(expected, out, 5);
}

void test_encode_zero_payload_is_four_bytes()
{
    uint8_t out[MAX_FRAME_SIZE] = {};
    size_t n = encode(frames::stop(), out, sizeof(out));
    TEST_ASSERT_EQUAL_UINT32(4, n);
    TEST_ASSERT_EQUAL_HEX8(0xAA, out[0]);
    TEST_ASSERT_EQUAL_HEX8(0x00, out[1]);
    TEST_ASSERT_EQUAL_HEX8(0x11, out[2]);
    const uint8_t header[] = {0x00, 0x11};
    TEST_ASSERT_EQUAL_HEX8(crc8(header, 2), out[3]);
}

void test_encode_crc_covers_len_cmd_payload_not_start()
{
    Frame f = raw_config(1, 500);
    uint8_t out[MAX_FRAME_SIZE] = {};
    size_t n = encode(f, out, sizeof(out));
    TEST_ASSERT_EQUAL_UINT32(7, n);
    // CRC over bytes 1..5 (LEN, CMD, 3 payload bytes)
    TEST_ASSERT_EQUAL_HEX8(crc8(&out[1], 5), out[6]);
}

void test_encode_rejects_oversized_payload()
{
    Frame f;
    f.cmd = Cmd::RUN;
    f.len = MAX_PAYLOAD + 1;
    uint8_t out[MAX_FRAME_SIZE] = {};
    TEST_ASSERT_EQUAL_UINT32(0, encode(f, out, sizeof(out)));
}

void test_encode_rejects_small_buffer()
{
    uint8_t out[4] = {};
    TEST_ASSERT_EQUAL_UINT32(0, encode(frames::run(1), out, sizeof(out)));
}

// ---------- parser helpers ----------

// Feeds every byte of buf into parser; returns how many frames came out,
// and stores the last one in last.
static int feed_all(FrameParser& parser, const uint8_t* buf, size_t n, Frame& last)
{
    int frames = 0;
    for (size_t i = 0; i < n; ++i)
    {
        Frame f;
        if (parser.feed(buf[i], f))
        {
            last = f;
            ++frames;
        }
    }
    return frames;
}

static void assert_frames_equal(const Frame& a, const Frame& b)
{
    TEST_ASSERT_EQUAL(a.cmd, b.cmd);
    TEST_ASSERT_EQUAL_UINT8(a.len, b.len);
    if (a.len > 0)
        TEST_ASSERT_EQUAL_UINT8_ARRAY(a.payload, b.payload, a.len);
}

// ---------- parser ----------

void test_parse_round_trip_every_command()
{
    const uint8_t two[] = {21, 22};
    const Frame inputs[] = {
        frames::run(3),
        frames::stop(),
        frames::status(),
        raw_config(1, 1234),
        frames::ack(Cmd::RUN),
        frames::nak(Cmd::CONFIG, ErrorCode::BAD_PARAM),
        frames::done(3),
        frames::status_reply(State::BUSY, 3),
        frames::wiring_begin(),
        frames::wiring_slot(3, two, 2),
        frames::wiring_commit(4, 6400),
    };
    for (const Frame& in : inputs)
    {
        FrameParser parser;
        uint8_t buf[MAX_FRAME_SIZE] = {};
        size_t n = encode(in, buf, sizeof(buf));
        Frame out;
        TEST_ASSERT_EQUAL_INT(1, feed_all(parser, buf, n, out));
        assert_frames_equal(in, out);
    }
}

void test_parse_skips_leading_garbage()
{
    FrameParser parser;
    uint8_t buf[MAX_FRAME_SIZE + 3] = {0x00, 0xFF, 0x42};
    size_t n = encode(frames::run(5), &buf[3], MAX_FRAME_SIZE);
    Frame out;
    TEST_ASSERT_EQUAL_INT(1, feed_all(parser, buf, 3 + n, out));
    TEST_ASSERT_EQUAL(Cmd::RUN, out.cmd);
    TEST_ASSERT_EQUAL_UINT8(5, out.payload[0]);
    TEST_ASSERT_EQUAL_UINT32(0, parser.dropped_frames());
}

void test_parse_rejects_bad_crc_then_accepts_next()
{
    FrameParser parser;
    uint8_t bad[MAX_FRAME_SIZE] = {};
    size_t nb = encode(frames::run(1), bad, sizeof(bad));
    bad[nb - 1] ^= 0xFF; // corrupt CRC

    uint8_t good[MAX_FRAME_SIZE] = {};
    size_t ng = encode(frames::run(2), good, sizeof(good));

    Frame out;
    TEST_ASSERT_EQUAL_INT(0, feed_all(parser, bad, nb, out));
    TEST_ASSERT_EQUAL_UINT32(1, parser.dropped_frames());
    TEST_ASSERT_EQUAL_INT(1, feed_all(parser, good, ng, out));
    TEST_ASSERT_EQUAL_UINT8(2, out.payload[0]);
}

void test_parse_rejects_len_over_max_and_recovers()
{
    FrameParser parser;
    const uint8_t bad[] = {0xAA, 0x09, 0x10}; // LEN 9 is invalid
    Frame out;
    TEST_ASSERT_EQUAL_INT(0, feed_all(parser, bad, sizeof(bad), out));
    TEST_ASSERT_EQUAL_UINT32(1, parser.dropped_frames());

    uint8_t good[MAX_FRAME_SIZE] = {};
    size_t ng = encode(frames::stop(), good, sizeof(good));
    TEST_ASSERT_EQUAL_INT(1, feed_all(parser, good, ng, out));
    TEST_ASSERT_EQUAL(Cmd::STOP, out.cmd);
}

void test_parse_two_frames_back_to_back()
{
    FrameParser parser;
    uint8_t buf[2 * MAX_FRAME_SIZE] = {};
    size_t n1 = encode(frames::run(7), buf, sizeof(buf));
    size_t n2 = encode(frames::done(7), &buf[n1], sizeof(buf) - n1);
    Frame out;
    TEST_ASSERT_EQUAL_INT(2, feed_all(parser, buf, n1 + n2, out));
    TEST_ASSERT_EQUAL(Cmd::DONE, out.cmd);
}

void test_parse_start_byte_inside_payload_is_data()
{
    FrameParser parser;
    Frame in = frames::run(FRAME_START); // slot 0xAA, legal as data
    uint8_t buf[MAX_FRAME_SIZE] = {};
    size_t n = encode(in, buf, sizeof(buf));
    Frame out;
    TEST_ASSERT_EQUAL_INT(1, feed_all(parser, buf, n, out));
    TEST_ASSERT_EQUAL_HEX8(0xAA, out.payload[0]);
}

void test_parse_max_payload_frame()
{
    FrameParser parser;
    Frame in;
    in.cmd = Cmd::CONFIG;
    in.len = MAX_PAYLOAD;
    for (uint8_t i = 0; i < MAX_PAYLOAD; ++i)
        in.payload[i] = static_cast<uint8_t>(0xF0 + i);
    uint8_t buf[MAX_FRAME_SIZE] = {};
    size_t n = encode(in, buf, sizeof(buf));
    TEST_ASSERT_EQUAL_UINT32(MAX_FRAME_SIZE, n);
    Frame out;
    TEST_ASSERT_EQUAL_INT(1, feed_all(parser, buf, n, out));
    assert_frames_equal(in, out);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_encode_run_slot_3_matches_protocol_md);
    RUN_TEST(test_encode_zero_payload_is_four_bytes);
    RUN_TEST(test_encode_crc_covers_len_cmd_payload_not_start);
    RUN_TEST(test_encode_rejects_oversized_payload);
    RUN_TEST(test_encode_rejects_small_buffer);
    RUN_TEST(test_parse_round_trip_every_command);
    RUN_TEST(test_parse_skips_leading_garbage);
    RUN_TEST(test_parse_rejects_bad_crc_then_accepts_next);
    RUN_TEST(test_parse_rejects_len_over_max_and_recovers);
    RUN_TEST(test_parse_two_frames_back_to_back);
    RUN_TEST(test_parse_start_byte_inside_payload_is_data);
    RUN_TEST(test_parse_max_payload_frame);
    return UNITY_END();
}
