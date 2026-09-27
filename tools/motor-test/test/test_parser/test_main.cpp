/**
 * @file test_main.cpp
 * @brief Host tests for the bench firmware's serial command parser.
 *
 * The contract under test: `run <pin> <steps>` yields Run with both fields
 * when the pin can safely be driven as a nENABLE output and the step count is
 * within range; `stop` and `pins` take no arguments; a blank line is Empty
 * rather than an error; and everything else is Invalid naming one reason.
 * The pins a run must refuse are the ones Motorcontrol reserves, plus the
 * input-only GPIOs, which would accept the write and never drive the driver.
 */
#include <unity.h>
#include "command_parser.h"
#include "pins.h"
#include <cstdio>

using namespace motortest;

namespace
{
    // Asserts a line is refused for exactly the stated reason.
    void assert_invalid(const char* line, ParseError expected)
    {
        const Command c = parse_command(line);
        TEST_ASSERT_EQUAL(static_cast<int>(CommandKind::Invalid), static_cast<int>(c.kind));
        TEST_ASSERT_EQUAL(static_cast<int>(expected), static_cast<int>(c.error));
    }

    // Asserts a slow line is accepted and carries all three fields.
    void assert_slow(const char* line, int pin, uint32_t steps, uint32_t interval)
    {
        const Command c = parse_command(line);
        TEST_ASSERT_EQUAL(static_cast<int>(CommandKind::Slow), static_cast<int>(c.kind));
        TEST_ASSERT_EQUAL(static_cast<int>(ParseError::None), static_cast<int>(c.error));
        TEST_ASSERT_EQUAL_INT(pin, c.pin);
        TEST_ASSERT_EQUAL_UINT32(steps, c.steps);
        TEST_ASSERT_EQUAL_UINT32(interval, c.interval_us);
    }

    // Asserts a run line is accepted and carries the stated pin and step count.
    void assert_run(const char* line, int pin, uint32_t steps)
    {
        const Command c = parse_command(line);
        TEST_ASSERT_EQUAL(static_cast<int>(CommandKind::Run), static_cast<int>(c.kind));
        TEST_ASSERT_EQUAL(static_cast<int>(ParseError::None), static_cast<int>(c.error));
        TEST_ASSERT_EQUAL_INT(pin, c.pin);
        TEST_ASSERT_EQUAL_UINT32(steps, c.steps);
    }
}

void setUp() {}
void tearDown() {}

void test_run_gives_pin_and_steps()
{
    assert_run("run 18 500", 18, 500);
}

void test_run_tolerates_surrounding_and_repeated_whitespace()
{
    assert_run("   run\t18    500  ", 18, 500);
}

void test_run_accepts_the_largest_allowed_step_count()
{
    assert_run("run 18 65535", 18, MAX_STEPS);
}

void test_stop_takes_no_arguments()
{
    const Command c = parse_command("stop");
    TEST_ASSERT_EQUAL(static_cast<int>(CommandKind::Stop), static_cast<int>(c.kind));
}

void test_pins_takes_no_arguments()
{
    const Command c = parse_command("pins");
    TEST_ASSERT_EQUAL(static_cast<int>(CommandKind::Pins), static_cast<int>(c.kind));
}

void test_blank_line_is_empty_not_an_error()
{
    TEST_ASSERT_EQUAL(static_cast<int>(CommandKind::Empty), static_cast<int>(parse_command("").kind));
    TEST_ASSERT_EQUAL(static_cast<int>(CommandKind::Empty), static_cast<int>(parse_command("   \t ").kind));
    TEST_ASSERT_EQUAL(static_cast<int>(CommandKind::Empty), static_cast<int>(parse_command(nullptr).kind));
}

void test_unknown_first_word_is_refused()
{
    assert_invalid("spin 18 500", ParseError::UnknownCommand);
}

void test_run_without_arguments_is_missing_pin()
{
    assert_invalid("run", ParseError::MissingPin);
}

void test_run_without_step_count_is_missing_steps()
{
    assert_invalid("run 18", ParseError::MissingSteps);
}

void test_non_numeric_fields_are_bad_numbers()
{
    assert_invalid("run abc 500", ParseError::BadNumber);
    assert_invalid("run 18 many", ParseError::BadNumber);
    assert_invalid("run -18 500", ParseError::BadNumber);
}

void test_extra_words_are_refused()
{
    assert_invalid("run 18 500 now", ParseError::TrailingInput);
    assert_invalid("stop now", ParseError::TrailingInput);
    assert_invalid("pins all", ParseError::TrailingInput);
}

void test_zero_steps_is_refused()
{
    assert_invalid("run 18 0", ParseError::StepsZero);
}

void test_step_count_above_the_cap_is_refused()
{
    assert_invalid("run 18 65536", ParseError::StepsTooLarge);
}

void test_pin_above_the_last_gpio_is_out_of_range()
{
    assert_invalid("run 40 500", ParseError::PinOutOfRange);
}

void test_input_only_pins_are_refused()
{
    // GPIO 34-39 have no output driver: the write would succeed and nothing would move.
    assert_invalid("run 34 500", ParseError::PinInputOnly);
    assert_invalid("run 39 500", ParseError::PinInputOnly);
}

void test_the_shared_step_line_is_reserved()
{
    const Command c = parse_command("run 4 500");
    TEST_ASSERT_EQUAL(static_cast<int>(ParseError::PinReserved), static_cast<int>(c.error));
    TEST_ASSERT_EQUAL_INT(4, Pins::STEP);
}

void test_the_uart_link_to_main_controller_is_reserved()
{
    assert_invalid("run 16 500", ParseError::PinReserved);
    assert_invalid("run 17 500", ParseError::PinReserved);
}

void test_the_console_uart_is_reserved()
{
    assert_invalid("run 1 500", ParseError::PinReserved);
    assert_invalid("run 3 500", ParseError::PinReserved);
}

void test_the_spi_flash_lines_are_reserved()
{
    for (int pin = 6; pin <= 11; ++pin)
    {
        char line[32];
        std::snprintf(line, sizeof(line), "run %d 500", pin);
        assert_invalid(line, ParseError::PinReserved);
    }
}

void test_is_reserved_pin_matches_the_motorcontrol_rule()
{
    TEST_ASSERT_TRUE(is_reserved_pin(Pins::STEP));
    TEST_ASSERT_TRUE(is_reserved_pin(Pins::UART_TX));
    TEST_ASSERT_TRUE(is_reserved_pin(Pins::UART_RX));
    TEST_ASSERT_FALSE(is_reserved_pin(18));
    TEST_ASSERT_FALSE(is_reserved_pin(23));
}

void test_every_error_has_a_description()
{
    const ParseError all[] = {
        ParseError::UnknownCommand, ParseError::MissingPin, ParseError::MissingSteps,
        ParseError::BadNumber, ParseError::TrailingInput, ParseError::PinOutOfRange,
        ParseError::PinInputOnly, ParseError::PinReserved, ParseError::StepsZero,
        ParseError::StepsTooLarge, ParseError::MissingInterval,
        ParseError::IntervalTooSmall, ParseError::IntervalTooLarge,
    };
    for (const ParseError e : all)
    {
        const char* text = describe(e);
        TEST_ASSERT_NOT_NULL(text);
        TEST_ASSERT_TRUE(text[0] != '\0');
    }
}

void test_slow_gives_pin_steps_and_interval()
{
    assert_slow("slow 18 6400 3000", 18, 6400, 3000);
}

void test_slow_accepts_the_interval_bounds()
{
    assert_slow("slow 18 100 100", 18, 100, MIN_INTERVAL_US);
    assert_slow("slow 18 100 50000", 18, 100, MAX_INTERVAL_US);
}

void test_run_leaves_the_interval_unset()
{
    // run pulses through the shipped generator, whose period is a firmware constant.
    TEST_ASSERT_EQUAL_UINT32(0, parse_command("run 18 6400").interval_us);
}

void test_slow_without_interval_is_missing_interval()
{
    assert_invalid("slow 18 6400", ParseError::MissingInterval);
}

void test_slow_interval_below_the_floor_is_refused()
{
    assert_invalid("slow 18 6400 99", ParseError::IntervalTooSmall);
}

void test_slow_interval_above_the_ceiling_is_refused()
{
    assert_invalid("slow 18 6400 50001", ParseError::IntervalTooLarge);
}

void test_slow_applies_the_same_pin_and_step_rules_as_run()
{
    assert_invalid("slow 4 6400 3000", ParseError::PinReserved);
    assert_invalid("slow 34 6400 3000", ParseError::PinInputOnly);
    assert_invalid("slow 18 0 3000", ParseError::StepsZero);
    assert_invalid("slow 18 65536 3000", ParseError::StepsTooLarge);
}

void test_slow_rejects_bad_numbers_and_extra_words()
{
    assert_invalid("slow 18 6400 fast", ParseError::BadNumber);
    assert_invalid("slow 18 6400 3000 now", ParseError::TrailingInput);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_run_gives_pin_and_steps);
    RUN_TEST(test_run_tolerates_surrounding_and_repeated_whitespace);
    RUN_TEST(test_run_accepts_the_largest_allowed_step_count);
    RUN_TEST(test_stop_takes_no_arguments);
    RUN_TEST(test_pins_takes_no_arguments);
    RUN_TEST(test_blank_line_is_empty_not_an_error);
    RUN_TEST(test_unknown_first_word_is_refused);
    RUN_TEST(test_run_without_arguments_is_missing_pin);
    RUN_TEST(test_run_without_step_count_is_missing_steps);
    RUN_TEST(test_non_numeric_fields_are_bad_numbers);
    RUN_TEST(test_extra_words_are_refused);
    RUN_TEST(test_zero_steps_is_refused);
    RUN_TEST(test_step_count_above_the_cap_is_refused);
    RUN_TEST(test_pin_above_the_last_gpio_is_out_of_range);
    RUN_TEST(test_input_only_pins_are_refused);
    RUN_TEST(test_the_shared_step_line_is_reserved);
    RUN_TEST(test_the_uart_link_to_main_controller_is_reserved);
    RUN_TEST(test_the_console_uart_is_reserved);
    RUN_TEST(test_the_spi_flash_lines_are_reserved);
    RUN_TEST(test_is_reserved_pin_matches_the_motorcontrol_rule);
    RUN_TEST(test_every_error_has_a_description);
    RUN_TEST(test_slow_gives_pin_steps_and_interval);
    RUN_TEST(test_slow_accepts_the_interval_bounds);
    RUN_TEST(test_run_leaves_the_interval_unset);
    RUN_TEST(test_slow_without_interval_is_missing_interval);
    RUN_TEST(test_slow_interval_below_the_floor_is_refused);
    RUN_TEST(test_slow_interval_above_the_ceiling_is_refused);
    RUN_TEST(test_slow_applies_the_same_pin_and_step_rules_as_run);
    RUN_TEST(test_slow_rejects_bad_numbers_and_extra_words);
    return UNITY_END();
}
