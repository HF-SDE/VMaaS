/**
 * @file test_main.cpp
 * @brief Host tests for the exact JSON text the backend must receive.
 *
 * The backend validates this with deviceEventSchema, so the field names and
 * nesting are a contract, not a preference. Pinning the text here means a
 * rename is caught on the PC instead of by a 400 from a machine in the field.
 */
#include <unity.h>
#include <cstring>
#include "sale_line.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

static SaleLine completed_sale()
{
    SaleLine l;
    l.event_id = "VM-16FEE909-000412";
    l.sequence_number = 412;
    l.slot = 12;
    l.price_minor = 1500;
    l.received_minor = 2000;
    l.status = SaleStatus::Completed;
    l.reason = nullptr;
    l.occurred_at = "2026-09-21T13:04:11Z";
    l.uptime_ms = 0;
    l.currency = "DKK";
    return l;
}

void test_completed_sale_is_formatted_exactly()
{
    char buf[512];
    const size_t n = format_sale_line(completed_sale(), buf, sizeof(buf));

    const char *expected =
        "{\"eventId\":\"VM-16FEE909-000412\",\"sequenceNumber\":412,"
        "\"type\":\"cash_sale\",\"occurredAt\":\"2026-09-21T13:04:11Z\","
        "\"payload\":{\"slot\":12,\"price_minor\":1500,\"received_minor\":2000,"
        "\"status\":\"completed\",\"currency\":\"DKK\"}}";

    TEST_ASSERT_EQUAL_STRING(expected, buf);
    TEST_ASSERT_EQUAL_UINT32(std::strlen(expected), n);
}

void test_failed_sale_carries_a_reason()
{
    SaleLine l = completed_sale();
    l.event_id = "VM-16FEE909-000414";
    l.sequence_number = 414;
    l.slot = 7;
    l.received_minor = 1500;
    l.status = SaleStatus::Failed;
    l.reason = "motor_nak";
    l.occurred_at = "2026-09-21T13:09:44Z";

    char buf[512];
    format_sale_line(l, buf, sizeof(buf));

    const char *expected =
        "{\"eventId\":\"VM-16FEE909-000414\",\"sequenceNumber\":414,"
        "\"type\":\"cash_sale\",\"occurredAt\":\"2026-09-21T13:09:44Z\","
        "\"payload\":{\"slot\":7,\"price_minor\":1500,\"received_minor\":1500,"
        "\"status\":\"failed\",\"reason\":\"motor_nak\",\"currency\":\"DKK\"}}";

    TEST_ASSERT_EQUAL_STRING(expected, buf);
}

// No clock: send uptime instead of a fabricated 1970 timestamp, and let the
// backend work out when it happened. Spec 8.3.
void test_unsynced_clock_emits_uptime_instead()
{
    SaleLine l = completed_sale();
    l.occurred_at = nullptr;
    l.uptime_ms = 734512;

    char buf[512];
    format_sale_line(l, buf, sizeof(buf));

    const char *expected =
        "{\"eventId\":\"VM-16FEE909-000412\",\"sequenceNumber\":412,"
        "\"type\":\"cash_sale\",\"uptimeMs\":734512,"
        "\"payload\":{\"slot\":12,\"price_minor\":1500,\"received_minor\":2000,"
        "\"status\":\"completed\",\"currency\":\"DKK\"}}";

    TEST_ASSERT_EQUAL_STRING(expected, buf);
}

// A line that does not fit must not be half-written: better no sale line at
// all than a truncated one that corrupts the queue.
void test_buffer_too_small_writes_nothing()
{
    char buf[32];
    std::memset(buf, 'x', sizeof(buf));

    const size_t n = format_sale_line(completed_sale(), buf, sizeof(buf));

    TEST_ASSERT_EQUAL_UINT32(0, n);
    TEST_ASSERT_EQUAL_CHAR('\0', buf[0]);
}

// The line must be one line: a newline inside it would split one event into
// two unparseable halves in the JSONL file.
void test_line_contains_no_newline()
{
    char buf[512];
    format_sale_line(completed_sale(), buf, sizeof(buf));

    TEST_ASSERT_NULL(std::strchr(buf, '\n'));
}

// A value too long for its intermediate buffer must fail the whole line, not
// produce one with an unterminated string in it. The closing quote is the
// first thing truncation eats, so a "shorter" result is the dangerous case.
void test_an_overlong_reason_writes_nothing()
{
    SaleLine l = completed_sale();
    static char long_reason[200];
    std::memset(long_reason, 'x', sizeof(long_reason) - 1);
    long_reason[sizeof(long_reason) - 1] = '\0';
    l.reason = long_reason;

    char buf[512];
    std::memset(buf, 'x', sizeof(buf));

    const size_t n = format_sale_line(l, buf, sizeof(buf));

    TEST_ASSERT_EQUAL_UINT32(0, n);
    TEST_ASSERT_EQUAL_CHAR('\0', buf[0]);
}

// A value too long for the occurred_at buffer must fail the whole line.
void test_an_overlong_occurred_at_writes_nothing()
{
    SaleLine l = completed_sale();
    static char long_occurred_at[100];
    std::memset(long_occurred_at, 'x', sizeof(long_occurred_at) - 1);
    long_occurred_at[sizeof(long_occurred_at) - 1] = '\0';
    l.occurred_at = long_occurred_at;

    char buf[512];
    std::memset(buf, 'x', sizeof(buf));

    const size_t n = format_sale_line(l, buf, sizeof(buf));

    TEST_ASSERT_EQUAL_UINT32(0, n);
    TEST_ASSERT_EQUAL_CHAR('\0', buf[0]);
}

// When event_id is null, the eventId key is omitted from the JSON output.
// This is valid because eventId is optional in the schema.
void test_null_event_id_omits_the_key()
{
    SaleLine l = completed_sale();
    l.event_id = nullptr;

    char buf[512];
    format_sale_line(l, buf, sizeof(buf));

    const char *expected =
        "{\"sequenceNumber\":412,"
        "\"type\":\"cash_sale\",\"occurredAt\":\"2026-09-21T13:04:11Z\","
        "\"payload\":{\"slot\":12,\"price_minor\":1500,\"received_minor\":2000,"
        "\"status\":\"completed\",\"currency\":\"DKK\"}}";

    TEST_ASSERT_EQUAL_STRING(expected, buf);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_completed_sale_is_formatted_exactly);
    RUN_TEST(test_failed_sale_carries_a_reason);
    RUN_TEST(test_unsynced_clock_emits_uptime_instead);
    RUN_TEST(test_buffer_too_small_writes_nothing);
    RUN_TEST(test_line_contains_no_newline);
    RUN_TEST(test_an_overlong_reason_writes_nothing);
    RUN_TEST(test_an_overlong_occurred_at_writes_nothing);
    RUN_TEST(test_null_event_id_omits_the_key);
    return UNITY_END();
}
