/**
 * @file onboarding_flow.cpp
 * @brief Screen transitions and row/backlight rendering for Wi-Fi onboarding.
 */
#include "onboarding_flow.h"

#include <cstring>

#include <cstdio>

namespace vmaas
{
    namespace
    {
        void copy_bounded(char* dst, const char* src, size_t dst_size)
        {
            size_t i = 0;
            if (src != nullptr) {
                for (; i + 1 < dst_size && src[i] != '\0'; ++i) {
                    dst[i] = src[i];
                }
            }
            dst[i] = '\0';
        }

        void copy_row(char* dst, const char* src)
        {
            copy_bounded(dst, src, 17);
        }
    }

    OnboardingFlow::OnboardingFlow(const char* device_name, const char* pin)
    {
        copy_bounded(name_, device_name, sizeof(name_));
        set_pin(pin);
    }

    void OnboardingFlow::set_pin(const char* pin)
    {
        char digits[9] = {};
        copy_bounded(digits, pin, sizeof(digits));
        if (digits[0] == '\0')
        {
            pin_row_[0] = '\0';
            return;
        }
        std::snprintf(pin_row_, sizeof(pin_row_), "PIN %.4s %.4s", digits, digits + 4);
    }

    void OnboardingFlow::set_retrying_stored_wifi(bool retrying)
    {
        retrying_stored_wifi_ = retrying;
    }

    void OnboardingFlow::set_networks(const char* const* ssids, size_t count)
    {
        network_count_ = 0;
        selection_ = 0;

        if (count > ONBOARDING_MAX_NETWORKS) {
            count = ONBOARDING_MAX_NETWORKS;
        }

        for (size_t i = 0; ssids != nullptr && i < count; ++i)
        {
            if (ssids[i] == nullptr) continue;
            copy_bounded(networks_[network_count_], ssids[i], sizeof(networks_[network_count_]));
            ++network_count_;
        }
    }

    void OnboardingFlow::begin(uint32_t now_ms)
    {
        screen_since_ms_ = now_ms;
        now_ms_ = now_ms;
    }

    void OnboardingFlow::set_connected_ssid(const char* ssid)
    {
        copy_bounded(chosen_ssid_, ssid, sizeof(chosen_ssid_));
    }

    void OnboardingFlow::on_remote_connecting(const char* ssid)
    {
        // A keypad attempt owns the radio until it is answered.
        if (connect_pending_) return;

        switch (screen_)
        {
            case OnboardingScreen::BleWaiting:
            case OnboardingScreen::NetworkList:
            case OnboardingScreen::SsidEntry:
            case OnboardingScreen::PasswordEntry:
            case OnboardingScreen::Connecting:
            case OnboardingScreen::WrongPassword:
                copy_bounded(chosen_ssid_, ssid, sizeof(chosen_ssid_));
                go(OnboardingScreen::Connecting, now_ms_);
                break;
            default:
                // Connected and everything after it: Wi-Fi is already done.
                break;
        }
    }

    void OnboardingFlow::on_connect_result(bool ok)
    {
        connect_pending_ = false;
        if (ok)
        {
            go(OnboardingScreen::Connected, now_ms_);
        }
        else
        {
            pass_entry_.reset();
            go(OnboardingScreen::WrongPassword, now_ms_);
        }
    }

    void OnboardingFlow::go(OnboardingScreen next, uint32_t now_ms)
    {
        screen_ = next;
        screen_since_ms_ = now_ms;
        now_ms_ = now_ms;
    }

    const char* OnboardingFlow::row_for_list_selection() const
    {
        if (selection_ >= network_count_) return "Enter manually";
        return networks_[selection_];
    }

    FlowState OnboardingFlow::handle(const KeyEvent& ev)
    {
        now_ms_ = ev.at_ms;
        const bool pressed = (ev.type == KeyEventType::Pressed);

        switch (screen_)
        {
        case OnboardingScreen::BleWaiting:
            if (pressed && ev.key == '*' && !retrying_stored_wifi_) {
                go(OnboardingScreen::NetworkList, ev.at_ms);
            }
            break;

        case OnboardingScreen::NetworkList:
            if (pressed)
            {
                switch (ev.key)
                {
                    case '*':
                        go(OnboardingScreen::BleWaiting, ev.at_ms);
                        break;
                    case '1':
                        if (selection_ > 0)
                            --selection_;
                        break;
                    case '3':
                        // Clamps at network_count_ (the [Enter manually] row)
                        // rather than wrapping - a long list should feel finite.
                        if (selection_ < network_count_)
                            ++selection_;
                        break;
                    case '5':
                        if (selection_ >= network_count_)
                        {
                            ssid_entry_.reset();
                            go(OnboardingScreen::SsidEntry, ev.at_ms);
                        }
                        else
                        {
                            copy_bounded(chosen_ssid_, networks_[selection_], sizeof(chosen_ssid_));
                            pass_entry_.reset();
                            go(OnboardingScreen::PasswordEntry, ev.at_ms);
                        }
                        break;
                    default:
                        break;
                }
            }
            break;

        case OnboardingScreen::SsidEntry:
        {
            const TextEntryState st = ssid_entry_.handle(ev);
            if (st.status == TextEntryStatus::Cancelled) {
                go(OnboardingScreen::NetworkList, ev.at_ms);

            } else if (st.status == TextEntryStatus::Done)
            {
                copy_bounded(chosen_ssid_, st.text, sizeof(chosen_ssid_));
                pass_entry_.reset();
                go(OnboardingScreen::PasswordEntry, ev.at_ms);
            }
            break;
        }

        case OnboardingScreen::PasswordEntry:
        {
            const TextEntryState st = pass_entry_.handle(ev);
            if (st.status == TextEntryStatus::Cancelled) {
                go(OnboardingScreen::NetworkList, ev.at_ms);
            } else if (st.status == TextEntryStatus::Done)
            {
                // Latches: stays true until on_connect_result() answers, so a
                // second key event drained in the same pass cannot discard it.
                connect_pending_ = true;
                go(OnboardingScreen::Connecting, ev.at_ms);
            }
            break;
        }

        case OnboardingScreen::Connecting:
            // Waiting on the driver's on_connect_result(); keys are inert here.
            break;

        case OnboardingScreen::WrongPassword:
            if (pressed)
            {
                if (ev.key == '*') {
                    go(OnboardingScreen::NetworkList, ev.at_ms);
                }
                else if (ev.key == '5') {
                    go(OnboardingScreen::PasswordEntry, ev.at_ms);
                }
            }
            break;

        case OnboardingScreen::Connected:
            break;

        case OnboardingScreen::CodeEntry:
            if (pressed)
            {
                if (ev.key >= '0' && ev.key <= '9')
                {
                    // A ninth digit is refused rather than shifting the code
                    // along or overwriting the first: both would silently lose
                    // a digit the technician believes they typed.
                    if (code_len_ < ONBOARDING_CODE_LEN)
                    {
                        code_[code_len_++] = ev.key;
                        code_[code_len_] = '\0';
                    }
                }
                else if (ev.key == '*')
                {
                    // On an empty code this does nothing, on purpose: Wi-Fi is
                    // already configured, so there is nothing behind this
                    // screen and only a valid code moves the machine forward.
                    if (code_len_ > 0) code_[--code_len_] = '\0';
                }
                else if (ev.key == '#' && code_len_ == ONBOARDING_CODE_LEN)
                {
                    // Latches until on_activation_result() answers, the same
                    // way connect_pending_ does, so a second key event drained
                    // in the same pass cannot discard it.
                    activate_pending_ = true;
                    go(OnboardingScreen::Activating, ev.at_ms);
                }
            }
            break;

        case OnboardingScreen::Activating:
            // Waiting on the driver's on_activation_result(); keys are inert.
            break;

        case OnboardingScreen::Activated:
            break;

        case OnboardingScreen::CodeRejected:
            if (pressed && ev.key == '5')
            {
                // The code was wrong, so resending it would only be rejected
                // again and burn another of the platform's ten attempts.
                clear_code();
                go(OnboardingScreen::CodeEntry, ev.at_ms);
            }
            break;

        case OnboardingScreen::ApiUnreachable:
            if (pressed && ev.key == '5')
            {
                // Nothing was wrong with the code: send the same one rather
                // than making the technician type eight digits again.
                activate_pending_ = true;
                go(OnboardingScreen::Activating, ev.at_ms);
            }
            break;

        case OnboardingScreen::CannotActivate:
            // A dead end by design. An unactivated machine can neither report
            // a sale nor take a command, so there is no key that starts the
            // sales loop.
            break;
        }

        return snapshot();
    }

    FlowState OnboardingFlow::tick(uint32_t now_ms)
    {
        now_ms_ = now_ms;

        if (screen_ == OnboardingScreen::SsidEntry) {
            ssid_entry_.tick(now_ms);
        } else if (screen_ == OnboardingScreen::PasswordEntry) {
            pass_entry_.tick(now_ms);
        } else if (screen_ == OnboardingScreen::Connected && now_ms - screen_since_ms_ >= ONBOARDING_CONNECTED_MS) {
            enter_activation_phase(now_ms);
        } else if (screen_ == OnboardingScreen::Activated && now_ms - screen_since_ms_ >= ONBOARDING_ACTIVATED_MS) {
            done_ = true;
        }

        return snapshot();
    }

    void OnboardingFlow::set_activation(ActivationNeed need) { need_ = need; }

    void OnboardingFlow::clear_code()
    {
        code_[0] = '\0';
        code_len_ = 0;
    }

    void OnboardingFlow::cannot_activate(const char* row0, const char* row1, uint32_t now_ms)
    {
        cannot_row0_ = row0;
        cannot_row1_ = row1;
        go(OnboardingScreen::CannotActivate, now_ms);
    }

    /*
     * Where the Wi-Fi phase hands over. Until this subsystem, a connected
     * machine was a finished machine; now `done` also requires a certificate,
     * and a machine that cannot get one stays here rather than selling blind.
     */
    void OnboardingFlow::enter_activation_phase(uint32_t now_ms)
    {
        switch (need_)
        {
            case ActivationNeed::NotNeeded:
                done_ = true;
                break;
            case ActivationNeed::Needed:
                clear_code();
                go(OnboardingScreen::CodeEntry, now_ms);
                break;
            case ActivationNeed::NoMachineId:
                // Naming the missing field beats failing an HTTPS call for a
                // reason nobody standing at the machine could work out.
                cannot_activate("No machine id", "Reflash config", now_ms);
                break;
            case ActivationNeed::NoApiAddress:
                cannot_activate("No API address", "Reflash config", now_ms);
                break;
        }
    }

    void OnboardingFlow::on_activation_result(ActivationOutcome outcome)
    {
        activate_pending_ = false;

        switch (outcome)
        {
            case ActivationOutcome::Ok:
                go(OnboardingScreen::Activated, now_ms_);
                break;
            case ActivationOutcome::CodeRejected:
                go(OnboardingScreen::CodeRejected, now_ms_);
                break;
            case ActivationOutcome::CodeExpired:
                // No path forward from the device: the customer has to claim
                // the machine again to get a fresh code.
                cannot_activate("Code expired", "Claim again", now_ms_);
                break;
            case ActivationOutcome::Unreachable:
                go(OnboardingScreen::ApiUnreachable, now_ms_);
                break;
        }
    }

    FlowState OnboardingFlow::state() const { return snapshot(); }

    FlowState OnboardingFlow::snapshot() const
    {
        FlowState out{};
        out.screen = screen_;
        out.connect_requested = connect_pending_;
        out.ssid = chosen_ssid_;

        const TextEntryState pass_st = pass_entry_.state();
        out.password = pass_st.text;

        // Readable on every screen, including an empty field after a rejection.
        out.activate_requested = activate_pending_;
        out.code = code_;
        out.done = done_;

        switch (screen_)
        {
            case OnboardingScreen::BleWaiting:
            {
                if (retrying_stored_wifi_)
                {
                    copy_row(out.row0, "Connecting...");
                    copy_row(out.row1, "");
                    out.r = 255; out.g = 200; out.b = 0;
                    break;
                }
                copy_row(out.row0, name_);
                const uint32_t cycle = (now_ms_ - screen_since_ms_) % (ONBOARDING_PIN_MS + ONBOARDING_HINT_MS);
                const bool show_pin = pin_row_[0] != '\0' && cycle < ONBOARDING_PIN_MS;
                copy_row(out.row1, show_pin ? pin_row_ : "* = manual setup");
                out.r = 0; out.g = 80; out.b = 255;
                break;
            }
            case OnboardingScreen::NetworkList:
                copy_row(out.row0, "Select network");
                std::snprintf(out.row1, sizeof(out.row1), "[%s]", row_for_list_selection());
                out.r = 255; out.g = 255; out.b = 255;
                break;
        
            case OnboardingScreen::SsidEntry:
            {
                const TextEntryState st = ssid_entry_.state();
                copy_row(out.row0, (st.text[0] == '\0') ? "SSID" : st.display);
                copy_row(out.row1, st.picker);
                out.r = 255; out.g = 255; out.b = 255;
                break;
            }
            case OnboardingScreen::PasswordEntry:
                copy_row(out.row0, (pass_st.text[0] == '\0') ? "Password" : pass_st.display);
                copy_row(out.row1, pass_st.picker);
                out.r = 255; out.g = 255; out.b = 255;
                break;
        
            case OnboardingScreen::Connecting:
                copy_row(out.row0, "Connecting...");
                copy_row(out.row1, "");
                out.r = 255; out.g = 200; out.b = 0;
                break;
        
            case OnboardingScreen::WrongPassword:
                copy_row(out.row0, "Wrong password");
                copy_row(out.row1, "5=retry  *=back");
                out.r = 255; out.g = 0; out.b = 0;
                break;
        
            case OnboardingScreen::Connected:
                copy_row(out.row0, "WiFi connected");
                copy_row(out.row1, chosen_ssid_);
                out.r = 0; out.g = 255; out.b = 0;
                break;

            case OnboardingScreen::CodeEntry:
                copy_row(out.row0, (code_len_ == 0) ? "Setup code" : code_);
                // Counting up is what tells the technician a press registered.
                // Eight digits with no feedback is easy to lose count of, and
                // a membrane keypad is not always kind about it.
                std::snprintf(out.row1, sizeof(out.row1), "%u of %u",
                              static_cast<unsigned>(code_len_),
                              static_cast<unsigned>(ONBOARDING_CODE_LEN));
                out.r = 255; out.g = 255; out.b = 255;
                break;

            case OnboardingScreen::Activating:
                copy_row(out.row0, "Activating...");
                copy_row(out.row1, "");
                out.r = 255; out.g = 200; out.b = 0;
                break;

            case OnboardingScreen::Activated:
                copy_row(out.row0, "Activated");
                copy_row(out.row1, name_);
                out.r = 0; out.g = 255; out.b = 0;
                break;

            case OnboardingScreen::CodeRejected:
                copy_row(out.row0, "Code rejected");
                copy_row(out.row1, "5=retry");
                out.r = 255; out.g = 0; out.b = 0;
                break;

            case OnboardingScreen::ApiUnreachable:
                copy_row(out.row0, "Cannot reach API");
                copy_row(out.row1, "5=retry");
                out.r = 255; out.g = 0; out.b = 0;
                break;

            case OnboardingScreen::CannotActivate:
                copy_row(out.row0, cannot_row0_);
                copy_row(out.row1, cannot_row1_);
                out.r = 255; out.g = 0; out.b = 0;
                break;
        }

        return out;
    }
}
