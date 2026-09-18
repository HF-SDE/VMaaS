/**
 * @file test_main.cpp
 * @brief Host tests for the onboarding screen flow.
 *
 * The contract under test: every screen says what it should, every key leads
 * where it should, no screen is a dead end, and done is true only after a
 * connection actually succeeded.
 */
#include <unity.h>
#include <cstring>
#include "onboarding_flow.h"

using namespace vmaas;

namespace
{
    KeyEvent press(char k, uint32_t at_ms = 0)
    {
        return KeyEvent{k, KeyEventType::Pressed, at_ms};
    }

    const char* const NETS[] = {"Cafe-Gaesten", "Office-5G"};

    OnboardingFlow make()
    {
        OnboardingFlow f("VMaaS-0042", "12345678");
        f.set_networks(NETS, 2);
        return f;
    }

    // Holds the state in a named local before measuring it, so nothing takes
    // a pointer into the temporary state() (or handle()) returns by value.
    void assert_fits(const FlowState& st)
    {
        TEST_ASSERT_LESS_OR_EQUAL_UINT(16, std::strlen(st.row0));
        TEST_ASSERT_LESS_OR_EQUAL_UINT(16, std::strlen(st.row1));
    }

    FlowState type(OnboardingFlow& f, const char* keys, uint32_t at_ms = 0)
    {
        FlowState st = f.state();
        for (const char* p = keys; *p != '\0'; ++p)
            st = f.handle(press(*p, at_ms));
        return st;
    }
}

void setUp() {}
void tearDown() {}

void test_starts_on_the_ble_screen_with_the_device_name()
{
    OnboardingFlow f = make();
    const FlowState st = f.state();
    TEST_ASSERT_EQUAL(OnboardingScreen::BleWaiting, st.screen);
    TEST_ASSERT_EQUAL_STRING("VMaaS-0042", st.row0);
    TEST_ASSERT_EQUAL_STRING("PIN 1234 5678", st.row1);
}

void test_ble_backlight_is_blue()
{
    OnboardingFlow f = make();
    const FlowState st = f.state();
    TEST_ASSERT_EQUAL_UINT8(0, st.r);
    TEST_ASSERT_EQUAL_UINT8(80, st.g);
    TEST_ASSERT_EQUAL_UINT8(255, st.b);
}

void test_ble_row_holds_the_pin_for_five_seconds_then_the_hint_for_three()
{
    OnboardingFlow f = make();
    TEST_ASSERT_EQUAL_STRING("PIN 1234 5678", f.tick(ONBOARDING_PIN_MS - 1).row1);
    TEST_ASSERT_EQUAL_STRING("* = manual setup", f.tick(ONBOARDING_PIN_MS).row1);
    TEST_ASSERT_EQUAL_STRING("* = manual setup",
                             f.tick(ONBOARDING_PIN_MS + ONBOARDING_HINT_MS - 1).row1);
    TEST_ASSERT_EQUAL_STRING("PIN 1234 5678",
                             f.tick(ONBOARDING_PIN_MS + ONBOARDING_HINT_MS).row1);
}

void test_star_opens_the_network_list()
{
    OnboardingFlow f = make();
    const FlowState st = f.handle(press('*'));
    TEST_ASSERT_EQUAL(OnboardingScreen::NetworkList, st.screen);
    TEST_ASSERT_EQUAL_STRING("Select network", st.row0);
    TEST_ASSERT_EQUAL_STRING("[Cafe-Gaesten]", st.row1);
}

void test_star_from_the_list_goes_back_to_ble()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    TEST_ASSERT_EQUAL(OnboardingScreen::BleWaiting, f.handle(press('*')).screen);
}

void test_one_and_three_move_through_the_list()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    TEST_ASSERT_EQUAL_STRING("[Office-5G]", f.handle(press('3')).row1);
    TEST_ASSERT_EQUAL_STRING("[Cafe-Gaesten]", f.handle(press('1')).row1);
}

void test_enter_manually_is_always_the_last_entry()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    f.handle(press('3'));
    TEST_ASSERT_EQUAL_STRING("[Enter manually]", f.handle(press('3')).row1);
    // And it does not run off the end.
    TEST_ASSERT_EQUAL_STRING("[Enter manually]", f.handle(press('3')).row1);
}

void test_enter_manually_is_offered_even_with_no_networks()
{
    OnboardingFlow f("VMaaS-0042", "12345678");
    f.set_networks(nullptr, 0);
    f.handle(press('*'));
    TEST_ASSERT_EQUAL_STRING("[Enter manually]", f.state().row1);
}

void test_picking_a_network_skips_the_ssid_screen()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    TEST_ASSERT_EQUAL(OnboardingScreen::PasswordEntry, f.handle(press('5')).screen);
}

void test_enter_manually_opens_the_ssid_screen()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    type(f, "33");
    TEST_ASSERT_EQUAL(OnboardingScreen::SsidEntry, f.handle(press('5')).screen);
}

void test_password_screen_labels_row0_until_something_is_typed()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    TEST_ASSERT_EQUAL_STRING("Password", f.handle(press('5')).row0);
    TEST_ASSERT_EQUAL_STRING("a", f.handle(press('5')).row0);
}

void test_finishing_the_password_requests_a_connection()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    f.handle(press('5'));                 // pick Cafe-Gaesten
    f.handle(press('5'));                 // type 'a'
    const FlowState st = f.handle(press('#'));
    TEST_ASSERT_EQUAL(OnboardingScreen::Connecting, st.screen);
    TEST_ASSERT_TRUE(st.connect_requested);
    TEST_ASSERT_EQUAL_STRING("Cafe-Gaesten", st.ssid);
    TEST_ASSERT_EQUAL_STRING("a", st.password);
    // The request latches until the driver reports back, so a second key event
    // drained in the same pass cannot discard it.
    TEST_ASSERT_TRUE(f.state().connect_requested);
    f.on_connect_result(false);
    TEST_ASSERT_FALSE(f.state().connect_requested);
}

void test_a_failed_connection_shows_the_error_screen()
{
    OnboardingFlow f = make();
    type(f, "*55#");
    f.on_connect_result(false);
    const FlowState st = f.state();
    TEST_ASSERT_EQUAL(OnboardingScreen::WrongPassword, st.screen);
    TEST_ASSERT_EQUAL_STRING("Wrong password", st.row0);
    TEST_ASSERT_EQUAL_STRING("5=retry  *=back", st.row1);
    TEST_ASSERT_EQUAL_UINT8(255, st.r);
    TEST_ASSERT_EQUAL_UINT8(0, st.g);
    TEST_ASSERT_FALSE(st.done);
}

void test_retry_returns_to_the_password_screen_for_the_same_network()
{
    OnboardingFlow f = make();
    type(f, "*55#");
    f.on_connect_result(false);
    const FlowState st = f.handle(press('5'));
    TEST_ASSERT_EQUAL(OnboardingScreen::PasswordEntry, st.screen);
    TEST_ASSERT_EQUAL_STRING("Password", st.row0);   // the old attempt is cleared
}

void test_back_from_the_error_screen_returns_to_the_list()
{
    OnboardingFlow f = make();
    type(f, "*55#");
    f.on_connect_result(false);
    TEST_ASSERT_EQUAL(OnboardingScreen::NetworkList, f.handle(press('*')).screen);
}

void test_done_only_after_a_successful_result_and_the_green_hold()
{
    OnboardingFlow f = make();
    type(f, "*55#", 1000);
    f.on_connect_result(true);
    const FlowState st = f.state();
    TEST_ASSERT_EQUAL(OnboardingScreen::Connected, st.screen);
    TEST_ASSERT_EQUAL_STRING("WiFi connected", st.row0);
    TEST_ASSERT_EQUAL_STRING("Cafe-Gaesten", st.row1);
    TEST_ASSERT_EQUAL_UINT8(0, st.r);
    TEST_ASSERT_EQUAL_UINT8(255, st.g);
    TEST_ASSERT_FALSE(st.done);
    TEST_ASSERT_TRUE(f.tick(1000 + ONBOARDING_CONNECTED_MS).done);
}

void test_star_on_an_empty_password_returns_to_the_list()
{
    OnboardingFlow f = make();
    f.handle(press('*'));
    f.handle(press('5'));
    TEST_ASSERT_EQUAL(OnboardingScreen::NetworkList, f.handle(press('*')).screen);
}

void test_ble_provisioned_connection_reaches_connected_with_its_ssid()
{
    // The BLE path: credentials arrive and are applied by the provisioning
    // component itself, with no keypad interaction at all, so the flow
    // never left BleWaiting and never learned an SSID on its own.
    OnboardingFlow f = make();
    TEST_ASSERT_EQUAL(OnboardingScreen::BleWaiting, f.state().screen);

    f.set_connected_ssid("Cafe-Gaesten");
    f.on_connect_result(true);

    const FlowState st = f.state();
    TEST_ASSERT_EQUAL(OnboardingScreen::Connected, st.screen);
    TEST_ASSERT_EQUAL_STRING("WiFi connected", st.row0);
    TEST_ASSERT_EQUAL_STRING("Cafe-Gaesten", st.row1);
    TEST_ASSERT_FALSE(st.done);
}

void test_begin_anchors_the_first_pin_phase_to_the_real_clock()
{
    // Without begin(), screen_since_ms_ starts at 0; on real hardware the
    // first tick() lands several seconds into boot, cutting the first PIN
    // phase short. begin() anchors it to whatever clock the driver hands in.
    OnboardingFlow f = make();
    f.begin(12345);
    TEST_ASSERT_EQUAL_STRING("PIN 1234 5678", f.tick(12345 + ONBOARDING_PIN_MS - 1).row1);
    TEST_ASSERT_EQUAL_STRING("* = manual setup", f.tick(12345 + ONBOARDING_PIN_MS).row1);
}

void test_every_row_fits_the_display()
{
    // BleWaiting: the initial screen.
    {
        OnboardingFlow f = make();
        const FlowState st = f.state();
        assert_fits(st);
    }

    // NetworkList: after '*'.
    {
        OnboardingFlow f = make();
        const FlowState st = f.handle(press('*'));
        assert_fits(st);
    }

    // BleWaiting again: '*' from the list goes back.
    {
        OnboardingFlow f = make();
        f.handle(press('*'));
        const FlowState st = f.handle(press('*'));
        assert_fits(st);
    }

    // SsidEntry: walk to [Enter manually] and press '5'.
    {
        OnboardingFlow f = make();
        f.handle(press('*'));
        type(f, "33");
        const FlowState st = f.handle(press('5'));
        assert_fits(st);
        // Wrong in an earlier round; pinned so it cannot silently regress.
        TEST_ASSERT_EQUAL_STRING("SSID", st.row0);
    }

    // PasswordEntry: pick a network with '5'.
    {
        OnboardingFlow f = make();
        f.handle(press('*'));
        const FlowState st = f.handle(press('5'));
        assert_fits(st);
    }

    // Connecting: '#' on the password screen.
    {
        OnboardingFlow f = make();
        type(f, "*55");
        const FlowState st = f.handle(press('#'));
        assert_fits(st);
        // Wrong in an earlier round; pinned so it cannot silently regress.
        TEST_ASSERT_EQUAL_STRING("Connecting...", st.row0);
    }

    // WrongPassword: on_connect_result(false).
    {
        OnboardingFlow f = make();
        type(f, "*55#");
        f.on_connect_result(false);
        const FlowState st = f.state();
        assert_fits(st);
    }

    // Connected: on_connect_result(true).
    {
        OnboardingFlow f = make();
        type(f, "*55#");
        f.on_connect_result(true);
        const FlowState st = f.state();
        assert_fits(st);
    }
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_starts_on_the_ble_screen_with_the_device_name);
    RUN_TEST(test_ble_backlight_is_blue);
    RUN_TEST(test_ble_row_holds_the_pin_for_five_seconds_then_the_hint_for_three);
    RUN_TEST(test_star_opens_the_network_list);
    RUN_TEST(test_star_from_the_list_goes_back_to_ble);
    RUN_TEST(test_one_and_three_move_through_the_list);
    RUN_TEST(test_enter_manually_is_always_the_last_entry);
    RUN_TEST(test_enter_manually_is_offered_even_with_no_networks);
    RUN_TEST(test_picking_a_network_skips_the_ssid_screen);
    RUN_TEST(test_enter_manually_opens_the_ssid_screen);
    RUN_TEST(test_password_screen_labels_row0_until_something_is_typed);
    RUN_TEST(test_finishing_the_password_requests_a_connection);
    RUN_TEST(test_a_failed_connection_shows_the_error_screen);
    RUN_TEST(test_retry_returns_to_the_password_screen_for_the_same_network);
    RUN_TEST(test_back_from_the_error_screen_returns_to_the_list);
    RUN_TEST(test_done_only_after_a_successful_result_and_the_green_hold);
    RUN_TEST(test_star_on_an_empty_password_returns_to_the_list);
    RUN_TEST(test_ble_provisioned_connection_reaches_connected_with_its_ssid);
    RUN_TEST(test_begin_anchors_the_first_pin_phase_to_the_real_clock);
    RUN_TEST(test_every_row_fits_the_display);
    return UNITY_END();
}
