/**
 * @file onboarding_flow.cpp
 * @brief Screen transitions and row/backlight rendering for Wi-Fi onboarding.
 */
#include "onboarding_flow.h"

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

        char digits[9] = {};
        copy_bounded(digits, pin, sizeof(digits));
        std::snprintf(pin_row_, sizeof(pin_row_), "PIN %.4s %.4s", digits, digits + 4);
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
            if (pressed && ev.key == '*') {
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
            done_ = true;
        }

        return snapshot();
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
        out.done = done_;

        switch (screen_)
        {
            case OnboardingScreen::BleWaiting:
            {
                copy_row(out.row0, name_);
                const uint32_t cycle = (now_ms_ - screen_since_ms_) % (ONBOARDING_PIN_MS + ONBOARDING_HINT_MS);
                copy_row(out.row1, (cycle < ONBOARDING_PIN_MS) ? pin_row_ : "* = manual setup");
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
                copy_row(out.row1, chosen_ssid_);
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
        }

        return out;
    }
}
