/**
 * @file test_main.cpp
 * @brief Host tests for parse_slot_config() validation of slot entries.
 *
 * Every rule that can make the cabinet wiring physically wrong is checked:
 * slot and pin ranges, input-only GPIOs used as motor outputs, two slots on
 * one pin, one slot number used twice, and the table size limit. Any such
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
    bool has_issue(const SlotParseResult& r, ConfigIssueKind kind, const char* field)
    {
        for (size_t i = 0; i < r.issue_count; ++i)
            if (r.issues[i].kind == kind && std::strcmp(r.issues[i].field, field) == 0)
                return true;
        return false;
    }

    // Builds {"slots":[{"slot":1,"pin":p0},{"slot":2,"pin":p0+1},...]} with n entries.
    std::string slots_file(int n, int first_pin = 0)
    {
        std::string s = "{\"slots\": [";
        for (int i = 0; i < n; ++i)
        {
            if (i) s += ",";
            s += "{\"slot\": " + std::to_string(i + 1) + ", \"pin\": " + std::to_string(first_pin + i) + "}";
        }
        return s + "]}";
    }

    void assert_unusable(const SlotParseResult& r)
    {
        TEST_ASSERT_FALSE(r.ok);
        TEST_ASSERT_EQUAL_UINT32(0, r.config.slot_count);
    }
}

void setUp() {}
void tearDown() {}

void test_slots_not_an_array_is_missing_field()
{
    const SlotParseResult r = parse_slot_config(R"({"slots": {"slot": 1, "pin": 18}})");
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots"));
}

void test_empty_slots_array_is_missing_field()
{
    const SlotParseResult r = parse_slot_config(R"({"slots": []})");
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots"));
}

void test_entry_not_an_object_is_wrong_type()
{
    const SlotParseResult r = parse_slot_config(R"({"slots": [{"slot": 1, "pin": 18}, 5]})");
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "slots[1]"));
}

void test_entry_missing_pin_or_slot_is_missing_field()
{
    const SlotParseResult r = parse_slot_config(R"({"slots": [{"slot": 1}, {"pin": 19}]})");
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots[0].pin"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::MissingField, "slots[1].slot"));
}

void test_string_and_fractional_values_are_wrong_type()
{
    const SlotParseResult r = parse_slot_config(R"({"slots": [{"slot": "1", "pin": 18.5}]})");
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "slots[0].slot"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::WrongType, "slots[0].pin"));
}

void test_slot_out_of_range()
{
    const SlotParseResult a = parse_slot_config(R"({"slots": [{"slot": 0, "pin": 18}]})");
    assert_unusable(a);
    TEST_ASSERT_TRUE(has_issue(a, ConfigIssueKind::OutOfRange, "slots[0].slot"));
    const SlotParseResult b = parse_slot_config(R"({"slots": [{"slot": 256, "pin": 18}]})");
    assert_unusable(b);
    TEST_ASSERT_TRUE(has_issue(b, ConfigIssueKind::OutOfRange, "slots[0].slot"));
}

void test_pin_out_of_range()
{
    const SlotParseResult a = parse_slot_config(R"({"slots": [{"slot": 1, "pin": -1}]})");
    assert_unusable(a);
    TEST_ASSERT_TRUE(has_issue(a, ConfigIssueKind::OutOfRange, "slots[0].pin"));
    const SlotParseResult b = parse_slot_config(R"({"slots": [{"slot": 1, "pin": 40}]})");
    assert_unusable(b);
    TEST_ASSERT_TRUE(has_issue(b, ConfigIssueKind::OutOfRange, "slots[0].pin"));
}

// GPIO 34-39 have no output driver on the ESP32, so they cannot drive a motor.
void test_input_only_pin_is_rejected()
{
    const SlotParseResult r = parse_slot_config(R"({"slots": [{"slot": 1, "pin": 34}]})");
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::InputOnlyPin, "slots[0].pin"));
}

void test_boundary_values_are_accepted()
{
    const SlotParseResult r = parse_slot_config(R"({"slots": [{"slot": 1, "pin": 0}, {"slot": 255, "pin": 33}]})");
    TEST_ASSERT_TRUE(r.ok);
    TEST_ASSERT_EQUAL_UINT32(2, r.config.slot_count);
    TEST_ASSERT_EQUAL_UINT8(255, r.config.slots[1].slot);
    TEST_ASSERT_EQUAL_INT(33, r.config.slots[1].pin);
}

void test_duplicate_slot_number_flags_the_later_entry()
{
    const SlotParseResult r = parse_slot_config(R"({"slots": [{"slot": 1, "pin": 18}, {"slot": 2, "pin": 19}, {"slot": 1, "pin": 21}]})");
    assert_unusable(r);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicateSlot, "slots[2].slot"));
}

void test_duplicate_pin_flags_the_later_entry()
{
    const SlotParseResult r = parse_slot_config(R"({"slots": [{"slot": 1, "pin": 18}, {"slot": 2, "pin": 18}]})");
    assert_unusable(r);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::DuplicatePin, "slots[1].pin"));
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
    s.replace(s.find("\"pin\": 0}"), 9, "\"pin\": 40}"); // first entry gets an invalid pin
    const SlotParseResult r = parse_slot_config(s.c_str());
    assert_unusable(r);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::TooManySlots, "slots"));
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "slots[0].pin"));
}

// Many bad entries: the issue list fills up to MAX_ISSUES and stops, never overflows.
void test_issue_list_saturates_at_max()
{
    std::string s = "{\"slots\": [";
    for (int i = 0; i < 12; ++i)
    {
        if (i) s += ",";
        s += "{\"slot\": " + std::to_string(i + 1) + ", \"pin\": 99}";
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
    const SlotParseResult r = parse_slot_config(R"({"slots": [{"slot": 1, "pin": 18}, {"slot": 2, "pin": 40}, {"slot": 3, "pin": 21}]})");
    assert_unusable(r);
    TEST_ASSERT_EQUAL_UINT32(1, r.issue_count);
}

// A double far outside long long cannot be cast to one: that conversion is
// undefined behaviour, not a wrap-around. The range test has to run first.
void test_astronomical_number_is_rejected_before_any_cast()
{
    const SlotParseResult r = parse_slot_config(R"({"slots": [{"slot": 1e300, "pin": 18}]})");
    TEST_ASSERT_FALSE(r.ok);
    TEST_ASSERT_TRUE(has_issue(r, ConfigIssueKind::OutOfRange, "slots[0].slot"));
    TEST_ASSERT_EQUAL_UINT(0, r.config.slot_count);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_slots_not_an_array_is_missing_field);
    RUN_TEST(test_empty_slots_array_is_missing_field);
    RUN_TEST(test_entry_not_an_object_is_wrong_type);
    RUN_TEST(test_entry_missing_pin_or_slot_is_missing_field);
    RUN_TEST(test_string_and_fractional_values_are_wrong_type);
    RUN_TEST(test_slot_out_of_range);
    RUN_TEST(test_pin_out_of_range);
    RUN_TEST(test_input_only_pin_is_rejected);
    RUN_TEST(test_boundary_values_are_accepted);
    RUN_TEST(test_duplicate_slot_number_flags_the_later_entry);
    RUN_TEST(test_duplicate_pin_flags_the_later_entry);
    RUN_TEST(test_max_slots_accepted_one_more_rejected);
    RUN_TEST(test_too_many_slots_still_reports_entry_issues);
    RUN_TEST(test_issue_list_saturates_at_max);
    RUN_TEST(test_one_bad_entry_makes_whole_file_unusable);
    RUN_TEST(test_astronomical_number_is_rejected_before_any_cast);
    return UNITY_END();
}
