/**
 * @file test_main.cpp
 * @brief Host tests for compaction and for what happens when the cap is hit
 *        with nothing acknowledged.
 */
#include <unity.h>
#include "fake_fs.h"
#include "journal.h"

using namespace vmaas::events;
using vmaas::events::test::CURSOR;
using vmaas::events::test::FakeFs;
using vmaas::events::test::JSONL;

void setUp() {}
void tearDown() {}

// Under the cap nothing moves: compaction is not free, and most boots never need it.
void test_nothing_happens_below_the_cap()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, 4096);
    j.begin();
    j.append("a", "{}", 1, 0);
    TEST_ASSERT_FALSE(j.compact_if_needed());

    Record out[4];
    TEST_ASSERT_EQUAL_UINT32(1, j.take(out, 4));
}

void test_acked_records_are_dropped_when_over_the_cap()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, 64); // tiny cap, a handful of records exceeds it
    j.begin();
    for (int i = 0; i < 6; ++i) j.append("door-released", "{}", 100, 0);
    j.ack_through(4);

    TEST_ASSERT_TRUE(j.compact_if_needed());

    Record out[8];
    TEST_ASSERT_EQUAL_UINT32(2, j.take(out, 8));
    TEST_ASSERT_EQUAL_UINT32(5, out[0].seq);
    TEST_ASSERT_EQUAL_UINT32(6, out[1].seq);
}

// Sequence numbers must not restart after the file is emptied: a reused number
// makes a duplicate eventId, which the platform drops as a replay.
void test_sequence_numbers_survive_compaction()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, 64);
    j.begin();
    for (int i = 0; i < 6; ++i) j.append("door-released", "{}", 100, 0);
    j.ack_through(6);
    j.compact_if_needed();

    TEST_ASSERT_EQUAL_UINT32(7, j.next_seq());
    TEST_ASSERT_EQUAL_UINT32(7, j.append("door-released", "{}", 100, 0));
}

// A machine offline for a very long time: bounded, counted loss beats a full
// filesystem, which would take config.json down with it.
void test_the_oldest_unsent_record_is_dropped_when_nothing_is_acked()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, 64);
    j.begin();
    for (int i = 0; i < 6; ++i) j.append("door-released", "{}", 100, 0);

    TEST_ASSERT_TRUE(j.compact_if_needed());
    TEST_ASSERT_TRUE(j.dropped() > 0);

    Record out[8];
    const uint32_t kept = j.take(out, 8);
    TEST_ASSERT_TRUE(kept > 0);
    TEST_ASSERT_TRUE(out[0].seq > 1); // the oldest went
}

void test_a_reopened_journal_reports_the_same_cursor_after_compaction()
{
    FakeFs fs;
    {
        Journal j(fs, JSONL, CURSOR, 64);
        j.begin();
        for (int i = 0; i < 6; ++i) j.append("door-released", "{}", 100, 0);
        j.ack_through(4);
        j.compact_if_needed();
    }
    Journal again(fs, JSONL, CURSOR, 64);
    again.begin();
    TEST_ASSERT_EQUAL_UINT32(4, again.acked());
    TEST_ASSERT_EQUAL_UINT32(7, again.next_seq());
}

// dropped() is the one number that tells a human events were lost, so it must
// not count a drop that never actually happened. When the rewrite that would
// remove the oldest records fails, nothing was removed and nothing may be
// counted.
void test_a_failed_rewrite_drops_nothing()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, 64);
    j.begin();
    for (int i = 0; i < 6; ++i) j.append("door-released", "{}", 100, 0);
    // Nothing acknowledged, so this exercises the drop-the-oldest path.
    fs.fail_rename = true;

    TEST_ASSERT_FALSE(j.compact_if_needed());
    TEST_ASSERT_EQUAL_UINT32(0, j.dropped());
}

// The bug this fix closes: an offline machine's journal must keep shrinking
// on every overflow it hits, not just the first one. Against the pre-fix
// code this fails, because dropping once raises acked_ above 0 and the
// "nothing acknowledged" branch can then never fire again.
void test_compaction_keeps_reclaiming_while_the_machine_stays_offline()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, 150);
    j.begin();
    for (int i = 0; i < 10; ++i) j.append("door-released", "{}", 100, 0);

    TEST_ASSERT_TRUE(j.compact_if_needed());
    const uint32_t dropped_after_first = j.dropped();
    TEST_ASSERT_TRUE(dropped_after_first > 0);

    for (int i = 0; i < 5; ++i) j.append("door-released", "{}", 100, 0);

    TEST_ASSERT_TRUE(j.compact_if_needed());
    TEST_ASSERT_TRUE(j.dropped() > dropped_after_first);
    TEST_ASSERT_TRUE(fs.files[JSONL].size() < 150);
}

// The other half of the bug: a machine that acknowledged something long ago
// and has been offline ever since has acked_ > 0 from the start, so gating
// the drop path on acked_ == 0 would miss it too. Against the pre-fix code
// this fails, because the acked_ != 0 branch never counts or drops anything.
void test_an_old_acknowledgement_does_not_disable_dropping()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, 150);
    j.begin();
    for (int i = 0; i < 12; ++i) j.append("door-released", "{}", 100, 0);
    j.ack_through(2); // acknowledged long ago; everything since is unsent

    TEST_ASSERT_TRUE(j.compact_if_needed());
    TEST_ASSERT_TRUE(j.dropped() > 0);
}

// Compaction runs exactly when storage is tight: if the filesystem fills
// mid-stream, a truncated temp file must never get installed over the
// journal. Against the pre-fix code this fails - append_line's result was
// ignored and ++kept ran unconditionally, so the rewrite "succeeded" and
// rename() replaced the journal with a temp file missing every record after
// the failure, with dropped() still reading 0.
void test_a_failed_append_during_compaction_leaves_the_journal_intact()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, 64);
    j.begin();
    for (int i = 0; i < 6; ++i) j.append("door-released", "{}", 100, 0);
    // Nothing acknowledged, so pass 1 tries to copy all 6 records into the
    // temp file - the same path a filesystem filling up mid-compaction takes.
    fs.fail_append_after_n = 2;

    TEST_ASSERT_FALSE(j.compact_if_needed());
    TEST_ASSERT_EQUAL_UINT32(0, j.dropped());

    Record out[8];
    const uint32_t kept = j.take(out, 8);
    TEST_ASSERT_EQUAL_UINT32(6, kept);
    for (uint32_t i = 0; i < kept; ++i) TEST_ASSERT_EQUAL_UINT32(i + 1, out[i].seq);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_nothing_happens_below_the_cap);
    RUN_TEST(test_acked_records_are_dropped_when_over_the_cap);
    RUN_TEST(test_sequence_numbers_survive_compaction);
    RUN_TEST(test_the_oldest_unsent_record_is_dropped_when_nothing_is_acked);
    RUN_TEST(test_a_reopened_journal_reports_the_same_cursor_after_compaction);
    RUN_TEST(test_a_failed_rewrite_drops_nothing);
    RUN_TEST(test_compaction_keeps_reclaiming_while_the_machine_stays_offline);
    RUN_TEST(test_an_old_acknowledgement_does_not_disable_dropping);
    RUN_TEST(test_a_failed_append_during_compaction_leaves_the_journal_intact);
    return UNITY_END();
}
