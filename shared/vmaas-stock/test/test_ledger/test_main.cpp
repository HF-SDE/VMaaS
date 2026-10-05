#include <unity.h>
#include <cstring>
#include "stock_ledger.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

namespace
{
    constexpr int64_t T0 = 1790000000; // an arbitrary UTC second

    StockBaseline baseline(const char* ledger, uint32_t as_of, uint32_t qty1, int64_t counted1 = 0)
    {
        StockBaseline b{};
        b.ack_count = 1;
        std::strcpy(b.acks[0].ledger, ledger);
        b.acks[0].as_of_sequence = as_of;
        b.slot_count = 2;
        b.slots[0] = {1, qty1, counted1};
        b.slots[1] = {2, 0, 0};
        return b;
    }
}

void test_no_baseline_enforces_nothing()
{
    StockLedger s;
    TEST_ASSERT_FALSE(s.has_baseline());
    TEST_ASSERT_FALSE(s.sold_out(1));
    TEST_ASSERT_FALSE(s.sold_out(7));
}

void test_baseline_without_own_sales_is_the_backend_quantity()
{
    StockLedger s;
    s.set_baseline(baseline("aaaa1111", 41, 5));
    TEST_ASSERT_EQUAL_UINT32(5, s.available(1));
    TEST_ASSERT_TRUE(s.sold_out(2));
}

void test_own_sale_the_backend_has_not_counted_is_subtracted()
{
    StockLedger s;
    s.set_baseline(baseline("aaaa1111", 41, 5));
    TEST_ASSERT_TRUE(s.record_sale("aaaa1111", 42, 1, T0));
    TEST_ASSERT_EQUAL_UINT32(4, s.available(1));
}

void test_counted_sale_is_not_subtracted_and_is_dropped_by_the_next_baseline()
{
    StockLedger s;
    s.set_baseline(baseline("aaaa1111", 41, 5));
    s.record_sale("aaaa1111", 42, 1, T0);
    s.record_sale("aaaa1111", 43, 1, T0);
    // The backend has now booked sale 42 and decremented for it.
    s.set_baseline(baseline("aaaa1111", 42, 4));
    TEST_ASSERT_EQUAL_UINT32(3, s.available(1));
    TEST_ASSERT_EQUAL_UINT32(1, s.own_sale_count());
    TEST_ASSERT_EQUAL_UINT32(43, s.own_sale(0).sequence);
}

void test_only_sales_after_the_count_are_subtracted()
{
    StockLedger s;
    s.record_sale("aaaa1111", 42, 1, T0 - 60); // before the count: already in the counted number
    s.record_sale("aaaa1111", 43, 1, T0 + 60); // after the count
    s.set_baseline(baseline("aaaa1111", 41, 10, T0));
    TEST_ASSERT_EQUAL_UINT32(9, s.available(1));
}

void test_sale_at_exactly_counted_at_is_not_subtracted()
{
    StockLedger s;
    s.record_sale("aaaa1111", 42, 1, T0);
    s.set_baseline(baseline("aaaa1111", 41, 10, T0));
    TEST_ASSERT_EQUAL_UINT32(10, s.available(1));
}

void test_sale_with_unknown_time_is_always_subtracted()
{
    StockLedger s;
    s.record_sale("aaaa1111", 42, 1, 0);
    s.set_baseline(baseline("aaaa1111", 41, 10, T0));
    TEST_ASSERT_EQUAL_UINT32(9, s.available(1));
}

void test_other_ledger_in_baseline_subtracts_all_own_sales()
{
    StockLedger s;
    // NVS was reset: the machine's new ledger restarts at 1, below the old ledger's 41.
    s.record_sale("bbbb2222", 1, 1, T0);
    s.record_sale("bbbb2222", 2, 1, T0);
    s.set_baseline(baseline("aaaa1111", 41, 5));
    TEST_ASSERT_EQUAL_UINT32(3, s.available(1));
    TEST_ASSERT_EQUAL_UINT32(2, s.own_sale_count()); // not acknowledged, so kept
}

void test_never_below_zero()
{
    StockLedger s;
    s.set_baseline(baseline("aaaa1111", 41, 1));
    s.record_sale("aaaa1111", 42, 1, T0);
    s.record_sale("aaaa1111", 43, 1, T0);
    TEST_ASSERT_EQUAL_UINT32(0, s.available(1));
    TEST_ASSERT_TRUE(s.sold_out(1));
}

void test_slot_missing_from_the_baseline_is_sold_out()
{
    StockLedger s;
    s.set_baseline(baseline("aaaa1111", 41, 5));
    TEST_ASSERT_TRUE(s.sold_out(9));
}

void test_full_list_sells_everything_out_and_refuses_more()
{
    StockLedger s;
    s.set_baseline(baseline("aaaa1111", 0, 1000));
    for (uint32_t i = 1; i <= STOCK_MAX_OWN_SALES; ++i) TEST_ASSERT_TRUE(s.record_sale("aaaa1111", i, 2, T0));
    TEST_ASSERT_TRUE(s.full());
    TEST_ASSERT_TRUE(s.sold_out(1));
    TEST_ASSERT_FALSE(s.record_sale("aaaa1111", STOCK_MAX_OWN_SALES + 1, 1, T0));
}

void test_parse_iso8601_utc()
{
    int64_t t = 0;
    TEST_ASSERT_TRUE(parse_iso8601_utc("1970-01-01T00:00:00Z", t));
    TEST_ASSERT_EQUAL_INT64(0, t);
    TEST_ASSERT_TRUE(parse_iso8601_utc("2026-09-29T09:14:00.000Z", t));
    TEST_ASSERT_EQUAL_INT64(1790673240, t);
    TEST_ASSERT_TRUE(parse_iso8601_utc("2024-02-29T12:00:00Z", t));
    TEST_ASSERT_EQUAL_INT64(1709208000, t);
    TEST_ASSERT_FALSE(parse_iso8601_utc("2026-09-29 09:14:00", t));
    TEST_ASSERT_FALSE(parse_iso8601_utc(nullptr, t));
}

void test_more_ledgers_than_the_table_holds_counts_as_full()
{
    StockLedger s;
    s.set_baseline(baseline("aaaa1111", 0, 10));
    const char* ledgers[] = {"l0000000", "l1111111", "l2222222", "l3333333"};
    for (const char* l : ledgers) TEST_ASSERT_TRUE(s.record_sale(l, 1, 1, T0));
    TEST_ASSERT_FALSE(s.record_sale("l4444444", 1, 1, T0));
    TEST_ASSERT_TRUE(s.full());
    TEST_ASSERT_TRUE(s.sold_out(1));
    // The next baseline counts l0's sale: its table entry frees up.
    s.set_baseline(baseline("l0000000", 1, 10));
    TEST_ASSERT_FALSE(s.full());
    TEST_ASSERT_TRUE(s.record_sale("l4444444", 1, 1, T0));
    TEST_ASSERT_EQUAL_UINT32(6, s.available(1));
}

void test_sale_time_survives_the_compact_storage()
{
    StockLedger s;
    s.record_sale("aaaa1111", 42, 3, T0);
    TEST_ASSERT_EQUAL_INT64(T0, s.own_sale(0).at);
    TEST_ASSERT_EQUAL_STRING("aaaa1111", s.own_sale(0).ledger);
    TEST_ASSERT_EQUAL_UINT8(3, s.own_sale(0).slot);
}

// The backend acknowledges every recent ledger, so sales from before an NVS
// reset are dropped once booked, instead of being subtracted forever.
void test_sales_of_an_older_ledger_are_dropped_once_acknowledged()
{
    StockLedger s;
    s.record_sale("aaaa1111", 1, 1, T0); // before the reset
    s.record_sale("aaaa1111", 2, 1, T0);
    s.record_sale("bbbb2222", 1, 1, T0); // after it
    StockBaseline b = baseline("bbbb2222", 0, 5);
    b.ack_count = 2;
    std::strcpy(b.acks[1].ledger, "aaaa1111");
    b.acks[1].as_of_sequence = 2;
    s.set_baseline(b);
    TEST_ASSERT_EQUAL_UINT32(1, s.own_sale_count());
    TEST_ASSERT_EQUAL_STRING("bbbb2222", s.own_sale(0).ledger);
    TEST_ASSERT_EQUAL_UINT32(4, s.available(1));
}

void test_baseline_with_no_acks_subtracts_every_own_sale()
{
    StockLedger s;
    s.record_sale("aaaa1111", 1, 1, T0);
    StockBaseline b = baseline("", 0, 5);
    b.ack_count = 0;
    s.set_baseline(b);
    TEST_ASSERT_EQUAL_UINT32(4, s.available(1));
}

// The own-sales file could not be read back: the machine may have sold items
// it no longer knows about, so it refuses everything until a fresh baseline.
void test_unreliable_sells_everything_out_until_the_next_baseline()
{
    StockLedger s;
    s.set_baseline(baseline("aaaa1111", 0, 5));
    s.mark_unreliable();
    TEST_ASSERT_TRUE(s.sold_out(1));
    s.set_baseline(baseline("aaaa1111", 0, 5));
    TEST_ASSERT_FALSE(s.sold_out(1));
}

void test_unreliable_before_any_baseline_still_sells_out()
{
    StockLedger s;
    s.mark_unreliable();
    TEST_ASSERT_TRUE(s.sold_out(1));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_no_baseline_enforces_nothing);
    RUN_TEST(test_baseline_without_own_sales_is_the_backend_quantity);
    RUN_TEST(test_own_sale_the_backend_has_not_counted_is_subtracted);
    RUN_TEST(test_counted_sale_is_not_subtracted_and_is_dropped_by_the_next_baseline);
    RUN_TEST(test_only_sales_after_the_count_are_subtracted);
    RUN_TEST(test_sale_at_exactly_counted_at_is_not_subtracted);
    RUN_TEST(test_sale_with_unknown_time_is_always_subtracted);
    RUN_TEST(test_other_ledger_in_baseline_subtracts_all_own_sales);
    RUN_TEST(test_never_below_zero);
    RUN_TEST(test_slot_missing_from_the_baseline_is_sold_out);
    RUN_TEST(test_full_list_sells_everything_out_and_refuses_more);
    RUN_TEST(test_parse_iso8601_utc);
    RUN_TEST(test_more_ledgers_than_the_table_holds_counts_as_full);
    RUN_TEST(test_sale_time_survives_the_compact_storage);
    RUN_TEST(test_sales_of_an_older_ledger_are_dropped_once_acknowledged);
    RUN_TEST(test_baseline_with_no_acks_subtracts_every_own_sale);
    RUN_TEST(test_unreliable_sells_everything_out_until_the_next_baseline);
    RUN_TEST(test_unreliable_before_any_baseline_still_sells_out);
    return UNITY_END();
}
