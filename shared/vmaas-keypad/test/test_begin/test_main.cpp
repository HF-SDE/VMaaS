/**
 * @file test_main.cpp
 * @brief Host tests for Keypad::begin() pin validation and the not-ready guard.
 *
 * begin() is the only place bad wiring can be caught before it turns into
 * silent nonsense at runtime: a duplicated pin would make two rows conduct as
 * one, and a negative pin would be handed straight to the GPIO driver. These
 * tests also pin down that tick() and next_event() are safe to call on an
 * unconfigured object, because main.cpp calls them from a task that starts
 * regardless of whether begin() succeeded.
 */
#include <unity.h>
#include "keypad.h"
#include "../fake_keypad_port.h"

using namespace vmaas;

static const int ROWS[4] = {14, 25, 26, 27};
static const int COLS[3] = {18, 19, 23};

void setUp() {}
void tearDown() {}

// The happy path must claim exactly the pins it was given, in order.
void test_begin_configures_the_given_pins()
{
    FakeKeypadPort port;
    Keypad kp(port);
    TEST_ASSERT_EQUAL(KeypadError::None, kp.begin(ROWS, 4, COLS, 3));
    TEST_ASSERT_TRUE(kp.ready());
    TEST_ASSERT_EQUAL_INT(4, (int)port.configured_rows.size());
    TEST_ASSERT_EQUAL_INT(3, (int)port.configured_cols.size());
    TEST_ASSERT_EQUAL_INT(14, port.configured_rows[0]);
    TEST_ASSERT_EQUAL_INT(23, port.configured_cols[2]);
}

// A count that does not match the 4x3 key map would index the map out of bounds.
void test_begin_rejects_wrong_counts()
{
    FakeKeypadPort port;
    Keypad kp(port);
    TEST_ASSERT_EQUAL(KeypadError::BadPinConfig, kp.begin(ROWS, 3, COLS, 3));
    TEST_ASSERT_EQUAL(KeypadError::BadPinConfig, kp.begin(ROWS, 4, COLS, 2));
    TEST_ASSERT_FALSE(kp.ready());
}

// A pin repeated anywhere means two lines are physically shorted; refuse it.
void test_begin_rejects_duplicate_pins()
{
    FakeKeypadPort port;
    Keypad kp(port);
    const int dup_rows[4] = {14, 25, 14, 27};
    TEST_ASSERT_EQUAL(KeypadError::BadPinConfig, kp.begin(dup_rows, 4, COLS, 3));

    const int clash_cols[3] = {18, 19, 27};   // 27 is also a row
    TEST_ASSERT_EQUAL(KeypadError::BadPinConfig, kp.begin(ROWS, 4, clash_cols, 3));
    TEST_ASSERT_FALSE(kp.ready());
}

// A negative pin is never a valid GPIO and must not reach the port.
void test_begin_rejects_negative_pins()
{
    FakeKeypadPort port;
    Keypad kp(port);
    const int bad_rows[4] = {14, -1, 26, 27};
    TEST_ASSERT_EQUAL(KeypadError::BadPinConfig, kp.begin(bad_rows, 4, COLS, 3));
    TEST_ASSERT_EQUAL_INT(0, port.configure_calls);
}

// A nullptr array is a caller bug, not a crash.
void test_begin_rejects_null_arrays()
{
    FakeKeypadPort port;
    Keypad kp(port);
    TEST_ASSERT_EQUAL(KeypadError::BadPinConfig, kp.begin(nullptr, 4, COLS, 3));
    TEST_ASSERT_EQUAL(KeypadError::BadPinConfig, kp.begin(ROWS, 4, nullptr, 3));
}

// When the port cannot claim the pins the driver must stay unready.
void test_begin_propagates_port_failure()
{
    FakeKeypadPort port;
    port.fail_configure = true;
    Keypad kp(port);
    TEST_ASSERT_EQUAL(KeypadError::GpioInitFailed, kp.begin(ROWS, 4, COLS, 3));
    TEST_ASSERT_FALSE(kp.ready());
}

// The scan task starts unconditionally, so these must be no-ops before begin().
void test_tick_and_next_event_are_safe_before_begin()
{
    FakeKeypadPort port;
    Keypad kp(port);
    port.press(0, 0);
    kp.tick(0);
    kp.tick(100);
    KeyEvent ev{};
    TEST_ASSERT_FALSE(kp.next_event(ev));
    TEST_ASSERT_EQUAL_INT(0, port.read_col_calls);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_begin_configures_the_given_pins);
    RUN_TEST(test_begin_rejects_wrong_counts);
    RUN_TEST(test_begin_rejects_duplicate_pins);
    RUN_TEST(test_begin_rejects_negative_pins);
    RUN_TEST(test_begin_rejects_null_arrays);
    RUN_TEST(test_begin_propagates_port_failure);
    RUN_TEST(test_tick_and_next_event_are_safe_before_begin);
    return UNITY_END();
}
