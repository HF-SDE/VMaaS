/**
 * @file test_main.cpp
 * @brief Host tests for the front door service code recogniser.
 *
 * The rule that matters most is the first one: an unconfigured machine has no
 * keypad route into the door at all, and a machine that does have a code still
 * sells exactly as it did before.
 */
#include <unity.h>
#include <initializer_list>
#include "service_code.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

static KeyEvent press(char k, uint32_t at_ms = 0)
{
    return KeyEvent{k, KeyEventType::Pressed, at_ms};
}

static ServiceCode configured(const char* code = "4711")
{
    ServiceCode s;
    s.set_code(code);
    return s;
}

// An empty code disables the feature: '*' must still reach the purchase flow.
void test_an_empty_code_consumes_nothing()
{
    ServiceCode s;
    s.set_code("");
    const ServiceState out = s.handle(press('*'));
    TEST_ASSERT_FALSE(out.consumed);
    TEST_ASSERT_EQUAL(ServiceStatus::Idle, out.status);
}

// Digits typed for a purchase must pass straight through.
void test_digits_pass_through_while_idle()
{
    ServiceCode s = configured();
    const ServiceState out = s.handle(press('7'));
    TEST_ASSERT_FALSE(out.consumed);
    TEST_ASSERT_EQUAL(ServiceStatus::Idle, out.status);
}

void test_star_starts_collecting_and_is_consumed()
{
    ServiceCode s = configured();
    const ServiceState out = s.handle(press('*'));
    TEST_ASSERT_TRUE(out.consumed);
    TEST_ASSERT_EQUAL(ServiceStatus::Collecting, out.status);
    TEST_ASSERT_EQUAL_UINT8(0, out.length);
}

void test_digits_are_masked_while_collecting()
{
    ServiceCode s = configured();
    s.handle(press('*'));
    s.handle(press('4'));
    const ServiceState out = s.handle(press('7'));
    TEST_ASSERT_TRUE(out.consumed);
    TEST_ASSERT_EQUAL_STRING("**", out.masked);
    TEST_ASSERT_EQUAL_UINT8(2, out.length);
}

void test_the_right_code_is_accepted()
{
    ServiceCode s = configured();
    s.handle(press('*'));
    s.handle(press('4'));
    s.handle(press('7'));
    s.handle(press('1'));
    s.handle(press('1'));
    const ServiceState out = s.handle(press('#'));
    TEST_ASSERT_TRUE(out.consumed);
    TEST_ASSERT_EQUAL(ServiceStatus::Accepted, out.status);
}

void test_the_wrong_code_is_rejected()
{
    ServiceCode s = configured();
    s.handle(press('*'));
    s.handle(press('4'));
    s.handle(press('7'));
    s.handle(press('1'));
    s.handle(press('2'));
    TEST_ASSERT_EQUAL(ServiceStatus::Rejected, s.handle(press('#')).status);
}

// A prefix of the code is not the code.
void test_a_short_code_is_rejected()
{
    ServiceCode s = configured();
    s.handle(press('*'));
    s.handle(press('4'));
    TEST_ASSERT_EQUAL(ServiceStatus::Rejected, s.handle(press('#')).status);
}

void test_the_recogniser_is_idle_again_after_a_verdict()
{
    ServiceCode s = configured();
    s.handle(press('*'));
    s.handle(press('4'));
    s.handle(press('#'));
    const ServiceState out = s.handle(press('7'));
    TEST_ASSERT_FALSE(out.consumed);
    TEST_ASSERT_EQUAL(ServiceStatus::Idle, out.status);
}

void test_star_backspaces()
{
    ServiceCode s = configured();
    s.handle(press('*'));
    s.handle(press('4'));
    s.handle(press('7'));
    const ServiceState out = s.handle(press('*'));
    TEST_ASSERT_TRUE(out.consumed);
    TEST_ASSERT_EQUAL_STRING("*", out.masked);
}

void test_star_on_an_empty_buffer_gives_up()
{
    ServiceCode s = configured();
    s.handle(press('*'));
    const ServiceState out = s.handle(press('*'));
    TEST_ASSERT_TRUE(out.consumed);
    TEST_ASSERT_EQUAL(ServiceStatus::Idle, out.status);
    // And the next key is a purchase again.
    TEST_ASSERT_FALSE(s.handle(press('7')).consumed);
}

// A ninth digit is ignored rather than shifting the buffer: unlike a slot
// number, a code the technician mistyped should fail, not silently become a
// different code.
void test_digits_past_the_maximum_are_ignored()
{
    ServiceCode s = configured("12345678");
    s.handle(press('*'));
    for (char c : {'1', '2', '3', '4', '5', '6', '7', '8'})
        s.handle(press(c));
    const ServiceState out = s.handle(press('9'));
    TEST_ASSERT_EQUAL_UINT8(8, out.length);
    TEST_ASSERT_EQUAL(ServiceStatus::Accepted, s.handle(press('#')).status);
}

void test_a_half_typed_code_times_out()
{
    ServiceCode s = configured();
    s.handle(press('*', 1000));
    s.handle(press('4', 1000));
    TEST_ASSERT_EQUAL(ServiceStatus::Collecting, s.tick(15000).status);
    TEST_ASSERT_EQUAL(ServiceStatus::TimedOut, s.tick(16001).status);
    // Reported once, then quiet.
    TEST_ASSERT_EQUAL(ServiceStatus::Idle, s.tick(17000).status);
}

void test_an_idle_recogniser_never_times_out()
{
    ServiceCode s = configured();
    TEST_ASSERT_EQUAL(ServiceStatus::Idle, s.tick(999999).status);
}

void test_released_events_are_never_consumed()
{
    ServiceCode s = configured();
    s.handle(press('*'));
    const KeyEvent up{'*', KeyEventType::Released, 0};
    TEST_ASSERT_FALSE(s.handle(up).consumed);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_an_empty_code_consumes_nothing);
    RUN_TEST(test_digits_pass_through_while_idle);
    RUN_TEST(test_star_starts_collecting_and_is_consumed);
    RUN_TEST(test_digits_are_masked_while_collecting);
    RUN_TEST(test_the_right_code_is_accepted);
    RUN_TEST(test_the_wrong_code_is_rejected);
    RUN_TEST(test_a_short_code_is_rejected);
    RUN_TEST(test_the_recogniser_is_idle_again_after_a_verdict);
    RUN_TEST(test_star_backspaces);
    RUN_TEST(test_star_on_an_empty_buffer_gives_up);
    RUN_TEST(test_digits_past_the_maximum_are_ignored);
    RUN_TEST(test_a_half_typed_code_times_out);
    RUN_TEST(test_an_idle_recogniser_never_times_out);
    RUN_TEST(test_released_events_are_never_consumed);
    return UNITY_END();
}
