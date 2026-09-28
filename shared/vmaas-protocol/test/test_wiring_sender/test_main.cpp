#include <unity.h>
#include "protocol.h"
#include "wiring_sender.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

namespace
{
    /// The bench table: 1 -> [18], 2 -> [21], 3 -> [22, 23], 6400 steps.
    WiringTable bench_table()
    {
        WiringTable t{};
        t.steps_per_vend = 6400;
        t.row_count = 3;
        t.rows[0] = {1, 1, {18}};
        t.rows[1] = {2, 1, {21}};
        t.rows[2] = {3, 2, {22, 23}};
        return t;
    }

    void assert_send(const WiringStep& s, Cmd cmd)
    {
        TEST_ASSERT_EQUAL(WiringStep::Kind::Send, s.kind);
        TEST_ASSERT_EQUAL_HEX8(static_cast<uint8_t>(cmd), static_cast<uint8_t>(s.frame.cmd));
    }

    void assert_wait(const WiringStep& s)
    {
        TEST_ASSERT_EQUAL(WiringStep::Kind::Wait, s.kind);
    }

    /// Drive a fresh sender through BEGIN and every SLOT, leaving COMMIT awaited.
    WiringStep run_to_commit(WiringSender& ws, uint32_t now)
    {
        const WiringTable t = bench_table();
        WiringStep s = ws.start(t, now);
        s = ws.on_ack(Cmd::WIRING_BEGIN, now);
        for (uint8_t i = 0; i < t.row_count; ++i) s = ws.on_ack(Cmd::WIRING_SLOT, now);
        return s;
    }
}

void test_happy_path_sends_begin_slots_commit_in_order()
{
    WiringSender ws;
    WiringStep s = ws.start(bench_table(), 0);
    assert_send(s, Cmd::WIRING_BEGIN);
    TEST_ASSERT_EQUAL_UINT8(0, s.frame.len);
    TEST_ASSERT_TRUE(ws.busy());

    s = ws.on_ack(Cmd::WIRING_BEGIN, 10);
    assert_send(s, Cmd::WIRING_SLOT);
    TEST_ASSERT_EQUAL_UINT8(3, s.frame.len);
    TEST_ASSERT_EQUAL_UINT8(1, s.frame.payload[0]);
    TEST_ASSERT_EQUAL_UINT8(1, s.frame.payload[1]);
    TEST_ASSERT_EQUAL_UINT8(18, s.frame.payload[2]);

    s = ws.on_ack(Cmd::WIRING_SLOT, 20);
    assert_send(s, Cmd::WIRING_SLOT);
    TEST_ASSERT_EQUAL_UINT8(2, s.frame.payload[0]);
    TEST_ASSERT_EQUAL_UINT8(21, s.frame.payload[2]);

    s = ws.on_ack(Cmd::WIRING_SLOT, 30);
    assert_send(s, Cmd::WIRING_SLOT);
    TEST_ASSERT_EQUAL_UINT8(4, s.frame.len);
    TEST_ASSERT_EQUAL_UINT8(3, s.frame.payload[0]);
    TEST_ASSERT_EQUAL_UINT8(2, s.frame.payload[1]);
    TEST_ASSERT_EQUAL_UINT8(22, s.frame.payload[2]);
    TEST_ASSERT_EQUAL_UINT8(23, s.frame.payload[3]);

    s = ws.on_ack(Cmd::WIRING_SLOT, 40);
    assert_send(s, Cmd::WIRING_COMMIT);
    TEST_ASSERT_EQUAL_UINT8(3, s.frame.len);
    TEST_ASSERT_EQUAL_UINT8(3, s.frame.payload[0]);                 // count
    TEST_ASSERT_EQUAL_UINT8(6400 & 0xFF, s.frame.payload[1]);        // steps LE
    TEST_ASSERT_EQUAL_UINT8((6400 >> 8) & 0xFF, s.frame.payload[2]);

    s = ws.on_ack(Cmd::WIRING_COMMIT, 50);
    TEST_ASSERT_EQUAL(WiringStep::Kind::Done, s.kind);
    TEST_ASSERT_FALSE(ws.busy());
}

void test_ack_for_other_command_is_ignored()
{
    WiringSender ws;
    ws.start(bench_table(), 0);
    assert_wait(ws.on_ack(Cmd::RUN, 10));
    assert_wait(ws.on_ack(Cmd::WIRING_SLOT, 10));   // BEGIN is awaited, not SLOT
    assert_send(ws.on_ack(Cmd::WIRING_BEGIN, 20), Cmd::WIRING_SLOT);
}

void test_nak_for_other_command_is_ignored()
{
    WiringSender ws;
    ws.start(bench_table(), 0);
    assert_wait(ws.on_nak(Cmd::RUN, ErrorCode::BUSY, 10));
    TEST_ASSERT_EQUAL_UINT8(1, ws.attempt());
    assert_send(ws.on_ack(Cmd::WIRING_BEGIN, 20), Cmd::WIRING_SLOT);
}

void test_no_reply_restarts_from_begin()
{
    WiringSender ws;
    ws.start(bench_table(), 0);
    ws.on_ack(Cmd::WIRING_BEGIN, 0);                       // SLOT 1 sent at 0
    assert_wait(ws.tick(WiringSender::REPLY_TIMEOUT_MS - 1));
    WiringStep s = ws.tick(WiringSender::REPLY_TIMEOUT_MS);
    assert_send(s, Cmd::WIRING_BEGIN);
    TEST_ASSERT_EQUAL_UINT8(2, ws.attempt());
}

void test_late_ack_after_restart_is_ignored()
{
    WiringSender ws;
    ws.start(bench_table(), 0);
    ws.on_ack(Cmd::WIRING_BEGIN, 0);                       // awaiting SLOT
    ws.tick(WiringSender::REPLY_TIMEOUT_MS);               // restart: awaiting BEGIN
    assert_wait(ws.on_ack(Cmd::WIRING_SLOT, 600));         // stale, from the old attempt
    WiringStep s = ws.on_ack(Cmd::WIRING_BEGIN, 610);
    assert_send(s, Cmd::WIRING_SLOT);
    TEST_ASSERT_EQUAL_UINT8(1, s.frame.payload[0]);        // back at the first row
}

void test_busy_on_commit_retries_commit_not_begin()
{
    WiringSender ws;
    run_to_commit(ws, 0);
    assert_wait(ws.on_nak(Cmd::WIRING_COMMIT, ErrorCode::BUSY, 100));
    assert_wait(ws.tick(100 + WiringSender::BUSY_RETRY_MS - 1));
    assert_send(ws.tick(100 + WiringSender::BUSY_RETRY_MS), Cmd::WIRING_COMMIT);
    TEST_ASSERT_EQUAL_UINT8(1, ws.attempt());
    TEST_ASSERT_EQUAL(WiringStep::Kind::Done, ws.on_ack(Cmd::WIRING_COMMIT, 700).kind);
}

void test_busy_retry_boundaries()
{
    WiringSender ws;
    run_to_commit(ws, 0);
    uint32_t now = 1000;
    ws.on_nak(Cmd::WIRING_COMMIT, ErrorCode::BUSY, now);    // BUSY first seen at 1000
    // Keep answering BUSY to every retried COMMIT until just before give-up.
    while (now + WiringSender::BUSY_RETRY_MS < 1000 + WiringSender::BUSY_GIVE_UP_MS)
    {
        now += WiringSender::BUSY_RETRY_MS;
        assert_send(ws.tick(now), Cmd::WIRING_COMMIT);
        assert_wait(ws.on_nak(Cmd::WIRING_COMMIT, ErrorCode::BUSY, now));
    }
    TEST_ASSERT_EQUAL_UINT8(1, ws.attempt());
    // A BUSY at exactly 8000 ms after the first one ends this attempt.
    now = 1000 + WiringSender::BUSY_GIVE_UP_MS;
    ws.tick(now);
    WiringStep s = ws.on_nak(Cmd::WIRING_COMMIT, ErrorCode::BUSY, now);
    assert_send(s, Cmd::WIRING_BEGIN);
    TEST_ASSERT_EQUAL_UINT8(2, ws.attempt());
}

void test_other_nak_restarts_from_begin()
{
    WiringSender ws;
    ws.start(bench_table(), 0);
    ws.on_ack(Cmd::WIRING_BEGIN, 0);
    WiringStep s = ws.on_nak(Cmd::WIRING_SLOT, ErrorCode::WIRING_STATE, 10);
    assert_send(s, Cmd::WIRING_BEGIN);
    TEST_ASSERT_EQUAL_UINT8(2, ws.attempt());
}

void test_three_failed_attempts_fail_with_last_nak()
{
    WiringSender ws;
    ws.start(bench_table(), 0);
    ws.on_nak(Cmd::WIRING_BEGIN, ErrorCode::WRITE_FAILED, 10);     // attempt 2
    ws.on_nak(Cmd::WIRING_BEGIN, ErrorCode::WRITE_FAILED, 20);     // attempt 3
    WiringStep s = ws.on_nak(Cmd::WIRING_BEGIN, ErrorCode::WIRING_FULL, 30);
    TEST_ASSERT_EQUAL(WiringStep::Kind::Failed, s.kind);
    TEST_ASSERT_EQUAL(WiringFailure::Nak, s.failure);
    TEST_ASSERT_EQUAL(ErrorCode::WIRING_FULL, s.nak);
    TEST_ASSERT_FALSE(ws.busy());
}

void test_three_timeouts_fail_with_no_reply()
{
    WiringSender ws;
    ws.start(bench_table(), 0);
    ws.tick(500);
    ws.tick(1000);
    WiringStep s = ws.tick(1500);
    TEST_ASSERT_EQUAL(WiringStep::Kind::Failed, s.kind);
    TEST_ASSERT_EQUAL(WiringFailure::NoReply, s.failure);
}

void test_start_refuses_unsendable_tables()
{
    WiringSender ws;
    WiringTable t = bench_table();
    t.rows[1].pin_count = WIRING_MAX_PINS + 1;
    TEST_ASSERT_EQUAL(WiringFailure::BadTable, ws.start(t, 0).failure);
    TEST_ASSERT_FALSE(ws.busy());

    t = bench_table();
    t.rows[0].pin_count = 0;
    TEST_ASSERT_EQUAL(WiringFailure::BadTable, ws.start(t, 0).failure);

    t = bench_table();
    t.row_count = 0;
    TEST_ASSERT_EQUAL(WiringFailure::BadTable, ws.start(t, 0).failure);

    t = bench_table();
    t.steps_per_vend = 0;
    TEST_ASSERT_EQUAL(WiringFailure::BadTable, ws.start(t, 0).failure);
}

void test_idle_sender_ignores_everything()
{
    WiringSender ws;
    assert_wait(ws.on_ack(Cmd::WIRING_COMMIT, 0));
    assert_wait(ws.on_nak(Cmd::WIRING_COMMIT, ErrorCode::BUSY, 0));
    assert_wait(ws.tick(100000));
    TEST_ASSERT_FALSE(ws.busy());
}

void test_restart_after_done()
{
    WiringSender ws;
    run_to_commit(ws, 0);
    ws.on_ack(Cmd::WIRING_COMMIT, 10);
    WiringStep s = ws.start(bench_table(), 20);
    assert_send(s, Cmd::WIRING_BEGIN);
    TEST_ASSERT_EQUAL_UINT8(1, ws.attempt());
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_happy_path_sends_begin_slots_commit_in_order);
    RUN_TEST(test_ack_for_other_command_is_ignored);
    RUN_TEST(test_nak_for_other_command_is_ignored);
    RUN_TEST(test_no_reply_restarts_from_begin);
    RUN_TEST(test_late_ack_after_restart_is_ignored);
    RUN_TEST(test_busy_on_commit_retries_commit_not_begin);
    RUN_TEST(test_busy_retry_boundaries);
    RUN_TEST(test_other_nak_restarts_from_begin);
    RUN_TEST(test_three_failed_attempts_fail_with_last_nak);
    RUN_TEST(test_three_timeouts_fail_with_no_reply);
    RUN_TEST(test_start_refuses_unsendable_tables);
    RUN_TEST(test_idle_sender_ignores_everything);
    RUN_TEST(test_restart_after_done);
    return UNITY_END();
}
