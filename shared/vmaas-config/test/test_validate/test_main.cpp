/**
 * @file test_main.cpp
 * @brief Host tests for parse_slot_config() validation of the motor block and
 *        the slot entries.
 *
 * Every rule that can make the cabinet wiring physically wrong is checked:
 * step count range, slot and pin ranges, input-only GPIOs used as motor
 * outputs, one GPIO used twice anywhere in the file, one slot number used
 * twice, too many pins on one slot, and the table size limit. Any such
 * problem makes the whole file unusable (ok == false, slot_count == 0).
 */
#include <unity.h>
#include <cstring>
#include <string>
#include "slot_config.h"
#include "slot_config_parser.h"

using namespace vmaas;

namespace
{
    constexpr const char* MOTOR = R"("motor": {"stepsPerVend": 6400},)";

    bool has_issue(const SlotParseResult& r, ConfigIssueKind kind, const char* field)
    {
        for (size_t i = 0; i < r.issue_count; ++i)
            if (r.issues[i].kind == kind && std::strcmp(r.issues[i].field, field) == 0)
                return true;
        return false;
    }

    // Wraps a slots-array body in a complete v2 file with the default motor block.
    std::string file(const char* slots_body)
    {
        return std::string("{") + MOTOR + "\"slots\": " + slots_body + "}";
    }

    // Builds a v2 file with n single-pin slots: slot i+1 on pin first_pin+i.
    std::string slots_file(int n, int first_pin = 0)
    {
        std::string s = std::string("{") + MOTOR + "\"slots\": [";
        for (int i = 0; i < n; ++i)
        {
            if (i) s += ",";
            s += "{\"slot\": " + std::to_string(i + 1) + ", \"pins\": [" + std::to_string(first_pin + i) + "]}";
        }
        return s + "]}";
    }

    void assert_unusable(const SlotParseResult& r)
    {
        TEST_ASSERT_FALSE(r.ok);
        TEST_ASSERT_EQUAL_UINT32(0, r.config.slot_count);
        TEST_ASSERT_EQUAL_UINT16(0, r.config.steps_per_vend);
    }
}

void setUp() {}
void tearDown() {}

// ---------- motor block ----------

void test_steps_per_vend_boundaries_are_accepted()
{
    const SlotParseResult lo = parse_slot_config(R"({"motor": {"stepsPerVend": 1}, "slots": [{"slot": 1, "pins": [18]}]})");
    TEST_ASSERT_TRUE(lo.ok);
    TEST_ASSERT_EQUAL_UINT16(1, lo.config.steps_per_vend);
    const SlotParseResult hi = parse_slot_config(R"({"motor": {"stepsPerVend": 65535}, "slots": [{"slot": 1, "pins": [18]}]})");
    TEST_ASSERT_TRUE(hi.ok);
    TEST_ASSERT_EQUAL_UINT16(65535, hi.config.steps_per_vend);
}

void test_steps_per_vend_out_of_range()
{
    const SlotParseResult zero = parse_slot_config(R"({"motor": {"stepsPerVend": 0}, "slots": [{"slot": 1, "pins": [18]}]})");
    assert_unusable(zero);
    TEST_ASSERT_TRUE(has_issue(zero, ConfigIssueKind::OutOfRange, "motor.stepsPerVend"));
    const SlotParseResult big = parse_slot_config(R"({"motor": {"stepsPerVend": 65536}, "slots": [{"slot": 1, "pins": [18]}]})");
    assert_unusable(big);
    TEST_ASSERT_TRUE(has_issue(big, ConfigIssueKind::OutOfRange, "motor.stepsPerVend"));
}

void test_steps_per_vend_string_or_fraction_is_wrong_type()
{
    const SlotParseResult s = parse_slot_config(R"({"motor": {"stepsPerVend": "6400"}, "slots": [{"slot": 1, "pins": [18]}]})");
    assert_unusable(s);
    TEST_ASSERT_TRUE(has_issue(s, ConfigIssueKind::WrongType, "motor.stepsPerVend"));
    const SlotParseResult f = parse_slot_config(R"({"motor": {"stepsPerVend": 6400.5}, "slots": [{"slot": 1, "pins": [18]}]})");
    assert_unusable(f);
    TEST_ASSERT_TRUE(has_issue(f, ConfigIssueKind::WrongType, "motor.stepsPerVend"));
}

// ---------- slots array ----------

void test_slots_not_an_array_is_missing_field()
{
    const SlotParseResult r = parse_slot_config(file(R"({"slot": 1, "pins": [18]})").c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots"));
}

void test_empty_slots_array_is_missing_field()
{
    const SlotParseResult r = parse_slot_config(file("[]").c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots"));
}

void test_entry_not_an_object_is_wrong_type()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [18]}, 5])").c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "slots[1]"));
}

void test_entry_missing_pins_or_slot_is_missing_field()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1}, {"pins": [19]}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots[0].pins"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots[1].slot"));
}

// The v1 scalar is not an alias for a one-element array.
void test_v1_pin_scalar_is_rejected()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pin": 18}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots[0].pins"));
}

void test_pins_not_an_array_or_empty_is_missing_field()
{
    const SlotParseResult a = parse_slot_config(file(R"([{"slot": 1, "pins": 18}])").c_str());
    assert_unusable(a);
    TEST_ASSERT_TRUE(has_issue(a, ConfigIssueKind::MissingField, "slots[0].pins"));
    const SlotParseResult b = parse_slot_config(file(R"([{"slot": 1, "pins": []}])").c_str());
    assert_unusable(b);
    TEST_ASSERT_TRUE(has_issue(b, ConfigIssueKind::MissingField, "slots[0].pins"));
}

void test_string_and_fractional_values_are_wrong_type()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": "1", "pins": [18.5]}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "slots[0].slot"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "slots[0].pins[0]"));
}

void test_slot_out_of_range()
{
    const SlotParseResult a = parse_slot_config(file(R"([{"slot": 0, "pins": [18]}])").c_str());
    assert_unusable(a);
    TEST_ASSERT_TRUE(has_issue(a, ConfigIssueKind::OutOfRange, "slots[0].slot"));
    const SlotParseResult b = parse_slot_config(file(R"([{"slot": 256, "pins": [18]}])").c_str());
    assert_unusable(b);
    TEST_ASSERT_TRUE(has_issue(b, ConfigIssueKind::OutOfRange, "slots[0].slot"));
}

void test_pin_out_of_range()
{
    const SlotParseResult a = parse_slot_config(file(R"([{"slot": 1, "pins": [-1]}])").c_str());
    assert_unusable(a);
    TEST_ASSERT_TRUE(has_issue(a, ConfigIssueKind::OutOfRange, "slots[0].pins[0]"));
    const SlotParseResult b = parse_slot_config(file(R"([{"slot": 1, "pins": [18, 40]}])").c_str());
    assert_unusable(b);
    TEST_ASSERT_TRUE(has_issue(b, ConfigIssueKind::OutOfRange, "slots[0].pins[1]"));
}

// GPIO 34-39 have no output driver on the ESP32, so they cannot drive nENABLE.
void test_input_only_pin_is_rejected()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [34]}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InputOnlyPin, "slots[0].pins[0]"));
}

void test_boundary_values_are_accepted()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [0]}, {"slot": 255, "pins": [33]}])").c_str());
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(2, r.config.slot_count);
    TEST_ASSERT_EQUAL_UINT8(255, r.config.slots[1].slot);
    TEST_ASSERT_EQUAL_UINT8(33, r.config.slots[1].pins[0]);
}

void test_six_pins_accepted_seven_rejected()
{
    const SlotParseResult six = parse_slot_config(file(R"([{"slot": 1, "pins": [0, 1, 2, 3, 4, 5]}])").c_str());
    TEST_ASSERT_TRUE(six.ok);
    TEST_ASSERT_EQUAL_UINT8(6, six.config.slots[0].pin_count);
    TEST_ASSERT_EQUAL_UINT8(5, six.config.slots[0].pins[5]);

    const SlotParseResult seven = parse_slot_config(file(R"([{"slot": 1, "pins": [0, 1, 2, 3, 4, 5, 12]}])").c_str());
    assert_unusable(seven);
    TEST_ASSERT_TRUE(has_issue(seven, ConfigIssueKind::OutOfRange, "slots[0].pins"));
}

void test_duplicate_slot_number_flags_the_later_entry()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [18]}, {"slot": 2, "pins": [19]}, {"slot": 1, "pins": [21]}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicateSlot, "slots[2].slot"));
}

void test_duplicate_pin_across_slots_flags_the_later_pin()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [18]}, {"slot": 2, "pins": [19, 18]}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicatePin, "slots[1].pins[1]"));
}

// Two spirals on one slot still need two different drivers.
void test_duplicate_pin_within_one_slot_flags_the_later_pin()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [21, 21]}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicatePin, "slots[0].pins[1]"));
}

void test_max_slots_accepted_one_more_rejected()
{
    const SlotParseResult ok = parse_slot_config(slots_file(32).c_str());
    TEST_ASSERT_TRUE(ok.ok);
    TEST_ASSERT_EQUAL_UINT32(32, ok.config.slot_count);

    const SlotParseResult bad = parse_slot_config(slots_file(33).c_str());
    assert_unusable(bad);
    TEST_ASSERT_TRUE(has_issue(bad, ConfigIssueKind::TooManySlots, "slots"));
}

// Too many entries must not stop the parser from naming the other problems it can see.
void test_too_many_slots_still_reports_entry_issues()
{
    std::string s = slots_file(33);
    s.replace(s.find("\"pins\": [0]"), 11, "\"pins\": [40]"); // first entry gets an invalid pin
    const SlotParseResult r = parse_slot_config(s.c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::TooManySlots, "slots"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "slots[0].pins[0]"));
}

// Many bad entries: the issue list fills up to MAX_ISSUES and stops, never overflows.
void test_issue_list_saturates_at_max()
{
    std::string s = std::string("{") + MOTOR + "\"slots\": [";
    for (int i = 0; i < 12; ++i)
    {
        if (i) s += ",";
        s += "{\"slot\": " + std::to_string(i + 1) + ", \"pins\": [99]}";
    }
    s += "]}";
    const SlotParseResult r = parse_slot_config(s.c_str());
    assert_unusable(r);
    TEST_ASSERT_EQUAL_UINT32(SlotParseResult::MAX_ISSUES, r.issue_count);
    for (size_t i = 0; i < r.issue_count; ++i)
        TEST_ASSERT_EQUAL(ConfigIssueKind::OutOfRange, r.issues[i].kind);
}

// One bad entry among good ones still makes the whole file unusable: no partial wiring.
void test_one_bad_entry_makes_whole_file_unusable()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1, "pins": [18]}, {"slot": 2, "pins": [40]}, {"slot": 3, "pins": [21]}])").c_str());
    assert_unusable(r);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
}

// A double far outside long long cannot be cast to one: that conversion is
// undefined behaviour, not a wrap-around. The range test has to run first.
void test_astronomical_number_is_rejected_before_any_cast()
{
    const SlotParseResult r = parse_slot_config(file(R"([{"slot": 1e300, "pins": [18]}])").c_str());
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "slots[0].slot"));
    TEST_ASSERT_EQUAL_UINT(0, r.config.slot_count);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_steps_per_vend_boundaries_are_accepted);
    RUN_TEST(test_steps_per_vend_out_of_range);
    RUN_TEST(test_steps_per_vend_string_or_fraction_is_wrong_type);
    RUN_TEST(test_slots_not_an_array_is_missing_field);
    RUN_TEST(test_empty_slots_array_is_missing_field);
    RUN_TEST(test_entry_not_an_object_is_wrong_type);
    RUN_TEST(test_entry_missing_pins_or_slot_is_missing_field);
    RUN_TEST(test_v1_pin_scalar_is_rejected);
    RUN_TEST(test_pins_not_an_array_or_empty_is_missing_field);
    RUN_TEST(test_string_and_fractional_values_are_wrong_type);
    RUN_TEST(test_slot_out_of_range);
    RUN_TEST(test_pin_out_of_range);
    RUN_TEST(test_input_only_pin_is_rejected);
    RUN_TEST(test_boundary_values_are_accepted);
    RUN_TEST(test_six_pins_accepted_seven_rejected);
    RUN_TEST(test_duplicate_slot_number_flags_the_later_entry);
    RUN_TEST(test_duplicate_pin_across_slots_flags_the_later_pin);
    RUN_TEST(test_duplicate_pin_within_one_slot_flags_the_later_pin);
    RUN_TEST(test_max_slots_accepted_one_more_rejected);
    RUN_TEST(test_too_many_slots_still_reports_entry_issues);
    RUN_TEST(test_issue_list_saturates_at_max);
    RUN_TEST(test_one_bad_entry_makes_whole_file_unusable);
    RUN_TEST(test_astronomical_number_is_rejected_before_any_cast);
    return UNITY_END();
}
