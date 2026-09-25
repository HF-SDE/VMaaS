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

// ---------------------------------------------------------------------------
// Activation (subsystem A). Wi-Fi is behind us in every test below.
// ---------------------------------------------------------------------------

namespace
{
    // Each digit key types itself, so the keys pressed and the code are the
    // same string.
    constexpr const char* FULL_CODE = "48273905";

    // Reaches the code screen the way the BLE path does: no keypad at all,
    // then the green hold elapses.
    void reach_code_screen(OnboardingFlow& f)
    {
        f.set_activation(ActivationNeed::Needed);
        f.set_connected_ssid("Cafe-Gaesten");
        f.on_connect_result(true);
        f.tick(ONBOARDING_CONNECTED_MS);
    }

    // Reaches the terminal screen for a machine that cannot activate at all.
    FlowState blocked_by(OnboardingFlow& f, ActivationNeed why)
    {
        f.set_activation(why);
        f.set_connected_ssid("Cafe-Gaesten");
        f.on_connect_result(true);
        return f.tick(ONBOARDING_CONNECTED_MS);
    }
}

void test_the_green_hold_leads_to_the_code_screen_when_activation_is_needed()
{
    OnboardingFlow f = make();
    f.set_activation(ActivationNeed::Needed);
    f.set_connected_ssid("Cafe-Gaesten");
    f.on_connect_result(true);

    const FlowState st = f.tick(ONBOARDING_CONNECTED_MS);
    TEST_ASSERT_EQUAL(OnboardingScreen::CodeEntry, st.screen);
    TEST_ASSERT_EQUAL_STRING("Setup code", st.row0);
    // Wi-Fi being up is no longer the end of onboarding.
    TEST_ASSERT_FALSE(st.done);
}

void test_a_full_code_requests_activation()
{
    OnboardingFlow f = make();
    reach_code_screen(f);

    const FlowState st = type(f, "48273905#");
    TEST_ASSERT_EQUAL(OnboardingScreen::Activating, st.screen);
    TEST_ASSERT_EQUAL_STRING("Activating...", st.row0);
    TEST_ASSERT_TRUE(st.activate_requested);
    TEST_ASSERT_EQUAL_STRING(FULL_CODE, st.code);
}

void test_hash_before_a_full_code_does_not_request_activation()
{
    OnboardingFlow f = make();
    reach_code_screen(f);

    // Four digits. The code is always exactly eight, so a short one is a
    // miscount, not a shorter code - sending it would only burn an attempt.
    const FlowState st = type(f, "4827#");
    TEST_ASSERT_EQUAL(OnboardingScreen::CodeEntry, st.screen);
    TEST_ASSERT_FALSE(st.activate_requested);
}

void test_each_digit_key_types_itself()
{
    OnboardingFlow f = make();
    reach_code_screen(f);

    // The whole point of a digit code: no picker, no charset, one press per
    // character. Row 0 shows what has been typed.
    const FlowState st = type(f, "4827");
    TEST_ASSERT_EQUAL_STRING("4827", st.code);
    TEST_ASSERT_EQUAL_STRING("4827", st.row0);
}

void test_row_one_counts_progress()
{
    OnboardingFlow f = make();
    reach_code_screen(f);

    TEST_ASSERT_EQUAL_STRING("0 of 8", f.state().row1);
    TEST_ASSERT_EQUAL_STRING("4 of 8", type(f, "4827").row1);
    TEST_ASSERT_EQUAL_STRING("8 of 8", type(f, "3905").row1);
}

void test_star_deletes_the_last_digit()
{
    OnboardingFlow f = make();
    reach_code_screen(f);

    type(f, "4827");
    TEST_ASSERT_EQUAL_STRING("482", type(f, "*").code);
    TEST_ASSERT_EQUAL_STRING("3 of 8", f.state().row1);
}

void test_star_on_an_empty_code_is_not_a_way_out()
{
    OnboardingFlow f = make();
    reach_code_screen(f);

    // Wi-Fi is already configured, so there is nothing behind this screen.
    const FlowState st = type(f, "***");
    TEST_ASSERT_EQUAL(OnboardingScreen::CodeEntry, st.screen);
    TEST_ASSERT_EQUAL_STRING("", st.code);
}

void test_a_ninth_digit_is_ignored()
{
    OnboardingFlow f = make();
    reach_code_screen(f);

    // Overwriting the first digit, or dropping the ninth silently into the
    // middle, would both be worse than refusing it.
    TEST_ASSERT_EQUAL_STRING(FULL_CODE, type(f, "482739051").code);
}

void test_the_empty_code_screen_says_what_it_wants()
{
    OnboardingFlow f = make();
    reach_code_screen(f);
    TEST_ASSERT_EQUAL_STRING("Setup code", f.state().row0);
}

void test_a_successful_activation_holds_green_then_finishes()
{
    OnboardingFlow f = make();
    reach_code_screen(f);
    type(f, "48273905#", 5000);
    f.on_activation_result(ActivationOutcome::Ok);

    const FlowState st = f.state();
    TEST_ASSERT_EQUAL(OnboardingScreen::Activated, st.screen);
    TEST_ASSERT_EQUAL_STRING("Activated", st.row0);
    TEST_ASSERT_EQUAL_UINT8(0, st.r);
    TEST_ASSERT_EQUAL_UINT8(255, st.g);
    TEST_ASSERT_EQUAL_UINT8(0, st.b);
    TEST_ASSERT_FALSE(st.done);
    TEST_ASSERT_TRUE(f.tick(5000 + ONBOARDING_ACTIVATED_MS).done);
}

void test_a_rejected_code_clears_the_field_for_the_retry()
{
    OnboardingFlow f = make();
    reach_code_screen(f);
    type(f, "48273905#");
    f.on_activation_result(ActivationOutcome::CodeRejected);

    const FlowState bad = f.state();
    TEST_ASSERT_EQUAL(OnboardingScreen::CodeRejected, bad.screen);
    TEST_ASSERT_EQUAL_STRING("Code rejected", bad.row0);
    TEST_ASSERT_EQUAL_STRING("5=retry", bad.row1);
    TEST_ASSERT_EQUAL_UINT8(255, bad.r);
    TEST_ASSERT_EQUAL_UINT8(0, bad.g);
    TEST_ASSERT_FALSE(bad.activate_requested);

    // The code itself was wrong, so sending it again would only be rejected
    // again: 5 goes back to an empty field.
    const FlowState again = f.handle(press('5'));
    TEST_ASSERT_EQUAL(OnboardingScreen::CodeEntry, again.screen);
    TEST_ASSERT_EQUAL_STRING("Setup code", again.row0);
    TEST_ASSERT_EQUAL_STRING("", again.code);
}

void test_an_unreachable_api_keeps_the_code_for_the_retry()
{
    OnboardingFlow f = make();
    reach_code_screen(f);
    type(f, "48273905#");
    f.on_activation_result(ActivationOutcome::Unreachable);

    const FlowState bad = f.state();
    TEST_ASSERT_EQUAL(OnboardingScreen::ApiUnreachable, bad.screen);
    TEST_ASSERT_EQUAL_STRING("Cannot reach API", bad.row0);
    TEST_ASSERT_EQUAL_STRING("5=retry", bad.row1);

    // Nothing was wrong with the code, so 5 sends the same twelve characters
    // again rather than making the technician retype them.
    const FlowState again = f.handle(press('5'));
    TEST_ASSERT_EQUAL(OnboardingScreen::Activating, again.screen);
    TEST_ASSERT_TRUE(again.activate_requested);
    TEST_ASSERT_EQUAL_STRING(FULL_CODE, again.code);
}

void test_an_expired_code_is_a_dead_end()
{
    OnboardingFlow f = make();
    reach_code_screen(f);
    type(f, "48273905#");
    f.on_activation_result(ActivationOutcome::CodeExpired);

    const FlowState st = f.state();
    TEST_ASSERT_EQUAL(OnboardingScreen::CannotActivate, st.screen);
    TEST_ASSERT_EQUAL_STRING("Code expired", st.row0);
    TEST_ASSERT_EQUAL_STRING("Claim again", st.row1);

    // The customer must claim the machine again; no key leads anywhere.
    TEST_ASSERT_EQUAL(OnboardingScreen::CannotActivate, type(f, "5#*13").screen);
    TEST_ASSERT_FALSE(f.tick(999999).done);
}

void test_a_missing_machine_id_never_asks_for_a_code()
{
    OnboardingFlow f = make();
    const FlowState st = blocked_by(f, ActivationNeed::NoMachineId);
    TEST_ASSERT_EQUAL(OnboardingScreen::CannotActivate, st.screen);
    TEST_ASSERT_EQUAL_STRING("No machine id", st.row0);
    TEST_ASSERT_EQUAL_STRING("Reflash config", st.row1);
    TEST_ASSERT_FALSE(st.done);

    // An unactivated machine can neither report a sale nor take a command,
    // so no key starts the sales loop either.
    TEST_ASSERT_FALSE(type(f, "5#*").done);
    TEST_ASSERT_FALSE(f.tick(999999).done);
}

void test_a_missing_api_address_never_asks_for_a_code()
{
    OnboardingFlow f = make();
    const FlowState st = blocked_by(f, ActivationNeed::NoApiAddress);
    TEST_ASSERT_EQUAL(OnboardingScreen::CannotActivate, st.screen);
    TEST_ASSERT_EQUAL_STRING("No API address", st.row0);
    TEST_ASSERT_EQUAL_STRING("Reflash config", st.row1);
    TEST_ASSERT_FALSE(f.tick(999999).done);
}

void test_an_already_activated_machine_finishes_at_the_green_hold()
{
    // The default: a machine that already holds a certificate goes straight
    // to the sales loop on every boot after the first.
    OnboardingFlow f = make();
    f.set_activation(ActivationNeed::NotNeeded);
    f.set_connected_ssid("Cafe-Gaesten");
    f.on_connect_result(true);
    TEST_ASSERT_TRUE(f.tick(ONBOARDING_CONNECTED_MS).done);
}

void test_every_activation_row_fits_the_display()
{
    {
        OnboardingFlow f = make();
        reach_code_screen(f);
        assert_fits(f.state());                       // CodeEntry, empty
        assert_fits(type(f, "48273905"));         // CodeEntry, full
        assert_fits(f.handle(press('#')));            // Activating
    }
    {
        OnboardingFlow f = make();
        reach_code_screen(f);
        type(f, "48273905#");
        f.on_activation_result(ActivationOutcome::Ok);
        assert_fits(f.state());                       // Activated
    }
    {
        OnboardingFlow f = make();
        reach_code_screen(f);
        type(f, "48273905#");
        f.on_activation_result(ActivationOutcome::CodeRejected);
        assert_fits(f.state());                       // CodeRejected
    }
    {
        OnboardingFlow f = make();
        reach_code_screen(f);
        type(f, "48273905#");
        f.on_activation_result(ActivationOutcome::Unreachable);
        assert_fits(f.state());                       // ApiUnreachable
    }
    {
        OnboardingFlow f = make();
        assert_fits(blocked_by(f, ActivationNeed::NoMachineId));
    }
    {
        OnboardingFlow f = make();
        assert_fits(blocked_by(f, ActivationNeed::NoApiAddress));
    }
}

// A machine whose stored credentials are stale reaches provisioning late:
// the driver gives them a bounded chance first, so the PIN does not exist
// when the flow is constructed.
void test_the_pin_row_can_be_set_after_construction()
{
    OnboardingFlow f("VMaaS-0042", "");
    TEST_ASSERT_EQUAL_STRING("PIN  ", f.state().row1);

    f.set_pin("85003199");
    const FlowState st = f.state();
    TEST_ASSERT_EQUAL(OnboardingScreen::BleWaiting, st.screen);
    TEST_ASSERT_EQUAL_STRING("PIN 8500 3199", st.row1);
    assert_fits(st);
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
    RUN_TEST(test_the_green_hold_leads_to_the_code_screen_when_activation_is_needed);
    RUN_TEST(test_a_full_code_requests_activation);
    RUN_TEST(test_hash_before_a_full_code_does_not_request_activation);
    RUN_TEST(test_each_digit_key_types_itself);
    RUN_TEST(test_row_one_counts_progress);
    RUN_TEST(test_star_deletes_the_last_digit);
    RUN_TEST(test_star_on_an_empty_code_is_not_a_way_out);
    RUN_TEST(test_a_ninth_digit_is_ignored);
    RUN_TEST(test_the_empty_code_screen_says_what_it_wants);
    RUN_TEST(test_a_successful_activation_holds_green_then_finishes);
    RUN_TEST(test_a_rejected_code_clears_the_field_for_the_retry);
    RUN_TEST(test_an_unreachable_api_keeps_the_code_for_the_retry);
    RUN_TEST(test_an_expired_code_is_a_dead_end);
    RUN_TEST(test_a_missing_machine_id_never_asks_for_a_code);
    RUN_TEST(test_a_missing_api_address_never_asks_for_a_code);
    RUN_TEST(test_an_already_activated_machine_finishes_at_the_green_hold);
    RUN_TEST(test_every_activation_row_fits_the_display);
    RUN_TEST(test_the_pin_row_can_be_set_after_construction);
    return UNITY_END();
}
