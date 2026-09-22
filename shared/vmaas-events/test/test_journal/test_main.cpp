/**
 * @file test_main.cpp
 * @brief Host tests for the journal's append/take/ack cycle, against a fake filesystem.
 */
#include <unity.h>
#include "fake_fs.h"
#include "journal.h"

using namespace vmaas::events;
using vmaas::events::test::CURSOR;
using vmaas::events::test::FakeFs;
using vmaas::events::test::JSONL;

namespace
{
    constexpr size_t CAP = 4096;
}

void setUp() {}
void tearDown() {}

void test_a_fresh_journal_starts_at_sequence_one()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, CAP);
    TEST_ASSERT_TRUE(j.begin());
    TEST_ASSERT_EQUAL_UINT32(1, j.next_seq());
    TEST_ASSERT_EQUAL_UINT32(0, j.acked());
}

void test_appending_assigns_increasing_sequence_numbers()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, CAP);
    j.begin();
    TEST_ASSERT_EQUAL_UINT32(1, j.append("door-released", "{}", 100, 0));
    TEST_ASSERT_EQUAL_UINT32(2, j.append("door-released", "{}", 200, 0));
    TEST_ASSERT_EQUAL_UINT32(3, j.next_seq());
}

void test_take_returns_the_oldest_unacked_records_in_order()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, CAP);
    j.begin();
    j.append("a", "{}", 1, 0);
    j.append("b", "{}", 2, 0);
    j.append("c", "{}", 3, 0);

    Record out[2];
    TEST_ASSERT_EQUAL_UINT32(2, j.take(out, 2));
    TEST_ASSERT_EQUAL_UINT32(1, out[0].seq);
    TEST_ASSERT_EQUAL_STRING("a", out[0].type);
    TEST_ASSERT_EQUAL_UINT32(2, out[1].seq);
}

void test_acking_moves_past_the_records_taken()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, CAP);
    j.begin();
    j.append("a", "{}", 1, 0);
    j.append("b", "{}", 2, 0);
    j.ack_through(1);

    Record out[4];
    TEST_ASSERT_EQUAL_UINT32(1, j.take(out, 4));
    TEST_ASSERT_EQUAL_UINT32(2, out[0].seq);
}

// The whole point of the design: a reboot must lose nothing.
void test_a_reopened_journal_resumes_where_it_stopped()
{
    FakeFs fs;
    {
        Journal j(fs, JSONL, CURSOR, CAP);
        j.begin();
        j.append("a", "{}", 1, 0);
        j.append("b", "{}", 2, 0);
        j.ack_through(1);
    }

    Journal again(fs, JSONL, CURSOR, CAP);
    TEST_ASSERT_TRUE(again.begin());
    TEST_ASSERT_EQUAL_UINT32(1, again.acked());
    TEST_ASSERT_EQUAL_UINT32(3, again.next_seq());

    Record out[4];
    TEST_ASSERT_EQUAL_UINT32(1, again.take(out, 4));
    TEST_ASSERT_EQUAL_UINT32(2, out[0].seq);
}

// A power cut during an append leaves a partial line. It must not be sent, and
// it must not stop the records behind it from being read.
void test_a_torn_last_line_is_ignored()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, CAP);
    j.begin();
    j.append("a", "{}", 1, 0);
    fs.files[JSONL] += "2|200|0|door-rel";

    Record out[4];
    TEST_ASSERT_EQUAL_UINT32(1, j.take(out, 4));
    TEST_ASSERT_EQUAL_UINT32(1, out[0].seq);
}

// The single most consequential behaviour in the journal: a lost cursor must
// never cause a sequence number to be reused, because a reused number mints a
// duplicate eventId that the platform silently drops as a replay.
void test_a_lost_cursor_resumes_after_the_highest_record()
{
    FakeFs fs;
    {
        Journal j(fs, JSONL, CURSOR, CAP);
        j.begin();
        j.append("a", "{}", 1, 0);
        j.append("b", "{}", 2, 0);
        j.append("c", "{}", 3, 0);
    }
    fs.remove(CURSOR); // the cursor is gone; the journal file itself is intact

    Journal again(fs, JSONL, CURSOR, CAP);
    TEST_ASSERT_TRUE(again.begin());
    TEST_ASSERT_EQUAL_UINT32(4, again.next_seq());
    TEST_ASSERT_EQUAL_UINT32(0, again.acked());
}

void test_appending_after_a_lost_cursor_never_reuses_a_sequence_number()
{
    FakeFs fs;
    {
        Journal j(fs, JSONL, CURSOR, CAP);
        j.begin();
        j.append("a", "{}", 1, 0);
        j.append("b", "{}", 2, 0);
        j.append("c", "{}", 3, 0);
    }
    fs.remove(CURSOR);

    Journal again(fs, JSONL, CURSOR, CAP);
    again.begin();
    TEST_ASSERT_EQUAL_UINT32(4, again.append("d", "{}", 4, 0));
}

// A cursor can be well-formed and still be WRONG: append() flushes the record
// before it persists the cursor, so a crash between the two leaves a cursor
// that under-reports next by one append's worth. begin() must not trust it
// blindly - it must cross-check the journal and take the larger of the two.
void test_a_stale_cursor_is_corrected_by_the_journal()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, CAP);
    j.begin();
    j.append("a", "{}", 1, 0);
    j.append("b", "{}", 2, 0);
    j.append("c", "{}", 3, 0);
    // Simulate the crash: the journal holds all three records, but the
    // cursor on disk still reflects the generation after only the second.
    fs.files[CURSOR] = "0|3";

    Journal again(fs, JSONL, CURSOR, CAP);
    TEST_ASSERT_TRUE(again.begin());
    TEST_ASSERT_EQUAL_UINT32(4, again.next_seq());
}

void test_appending_after_a_stale_cursor_never_reuses_a_sequence_number()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, CAP);
    j.begin();
    j.append("a", "{}", 1, 0);
    j.append("b", "{}", 2, 0);
    j.append("c", "{}", 3, 0);
    fs.files[CURSOR] = "0|3";

    Journal again(fs, JSONL, CURSOR, CAP);
    again.begin();
    TEST_ASSERT_EQUAL_UINT32(4, again.append("d", "{}", 4, 0));
}

// The mirror image, and the case that stops a future "just scan the journal"
// simplification: compaction (a later task) can empty the journal file
// completely while the sequence number must keep climbing. Here the cursor
// is AHEAD of an empty journal, and it must win.
void test_a_cursor_ahead_of_an_empty_journal_is_trusted()
{
    FakeFs fs;
    fs.files[JSONL] = "";
    fs.files[CURSOR] = "6|7";

    Journal j(fs, JSONL, CURSOR, CAP);
    TEST_ASSERT_TRUE(j.begin());
    TEST_ASSERT_EQUAL_UINT32(7, j.next_seq());
    TEST_ASSERT_EQUAL_UINT32(6, j.acked());
}

// A single corrupt line must not hide the good records that follow it. Unlike
// a torn trailing line (which FakeFs withholds from the visitor entirely
// because it has no newline), this line is complete, so the visitor is
// actually called with it and decode_record's failure path is what skips it.
void test_a_malformed_line_between_good_records_is_skipped()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, CAP);
    j.begin();
    j.append("a", "{}", 1, 0);
    fs.files[JSONL] += "not-a-record\n";
    j.append("b", "{}", 2, 0);

    Record out[4];
    TEST_ASSERT_EQUAL_UINT32(2, j.take(out, 4));
    TEST_ASSERT_EQUAL_UINT32(1, out[0].seq);
    TEST_ASSERT_EQUAL_STRING("a", out[0].type);
    TEST_ASSERT_EQUAL_UINT32(2, out[1].seq);
    TEST_ASSERT_EQUAL_STRING("b", out[1].type);
}

void test_a_payload_with_a_newline_is_refused()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, CAP);
    j.begin();
    TEST_ASSERT_EQUAL_UINT32(0, j.append("door-released", "{\"a\":\"b\nc\"}", 1, 0));
    TEST_ASSERT_EQUAL_UINT32(1, j.next_seq());
}

void test_taking_from_an_empty_journal_returns_nothing()
{
    FakeFs fs;
    Journal j(fs, JSONL, CURSOR, CAP);
    j.begin();
    Record out[4];
    TEST_ASSERT_EQUAL_UINT32(0, j.take(out, 4));
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_a_fresh_journal_starts_at_sequence_one);
    RUN_TEST(test_appending_assigns_increasing_sequence_numbers);
    RUN_TEST(test_take_returns_the_oldest_unacked_records_in_order);
    RUN_TEST(test_acking_moves_past_the_records_taken);
    RUN_TEST(test_a_reopened_journal_resumes_where_it_stopped);
    RUN_TEST(test_a_torn_last_line_is_ignored);
    RUN_TEST(test_a_lost_cursor_resumes_after_the_highest_record);
    RUN_TEST(test_appending_after_a_lost_cursor_never_reuses_a_sequence_number);
    RUN_TEST(test_a_stale_cursor_is_corrected_by_the_journal);
    RUN_TEST(test_appending_after_a_stale_cursor_never_reuses_a_sequence_number);
    RUN_TEST(test_a_cursor_ahead_of_an_empty_journal_is_trusted);
    RUN_TEST(test_a_malformed_line_between_good_records_is_skipped);
    RUN_TEST(test_a_payload_with_a_newline_is_refused);
    RUN_TEST(test_taking_from_an_empty_journal_returns_nothing);
    return UNITY_END();
}
