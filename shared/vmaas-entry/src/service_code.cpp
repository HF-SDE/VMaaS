#include "service_code.h"

#include <cstdio>
#include <cstring>

namespace vmaas
{
    ServiceCode::ServiceCode(uint32_t timeout_ms) : timeout_ms_(timeout_ms) {}

    void ServiceCode::set_code(const char* code)
    {
        std::snprintf(code_, sizeof(code_), "%s", code == nullptr ? "" : code);
        reset();
    }

    void ServiceCode::reset()
    {
        std::memset(buffer_, 0, sizeof(buffer_));
        length_ = 0;
        collecting_ = false;
    }

    ServiceState ServiceCode::snapshot(ServiceStatus status, bool consumed) const
    {
        ServiceState s{};
        s.status = status;
        s.consumed = consumed;
        s.length = length_;
        for (uint8_t i = 0; i < length_; ++i) s.masked[i] = '*';
        s.masked[length_] = '\0';
        return s;
    }

    ServiceState ServiceCode::handle(const KeyEvent& ev)
    {
        if (ev.type != KeyEventType::Pressed) return snapshot(collecting_ ? ServiceStatus::Collecting : ServiceStatus::Idle, false);

        if (code_[0] == '\0') return snapshot(ServiceStatus::Idle, false);

        if (!collecting_)
        {
            if (ev.key != '*') return snapshot(ServiceStatus::Idle, false);
            collecting_ = true;
            last_key_ms_ = ev.at_ms;
            return snapshot(ServiceStatus::Collecting, true);
        }

        last_key_ms_ = ev.at_ms;

        if (ev.key == '*')
        {
            if (length_ == 0)
            {
                reset();
                return snapshot(ServiceStatus::Idle, true);
            }
            buffer_[--length_] = '\0';
            return snapshot(ServiceStatus::Collecting, true);
        }

        if (ev.key == '#')
        {
            bool match = (length_ == std::strlen(code_));
            for (uint8_t i = 0; i < length_; ++i) {
                match &= (buffer_[i] == code_[i]);
            }

            reset();
            return snapshot(match ? ServiceStatus::Accepted : ServiceStatus::Rejected, true);
        }

        if (length_ < SERVICE_CODE_MAX_DIGITS)
        {
            buffer_[length_++] = ev.key;
            buffer_[length_] = '\0';
        }
        return snapshot(ServiceStatus::Collecting, true);
    }

    ServiceState ServiceCode::tick(uint32_t now_ms)
    {
        if (!collecting_ || timeout_ms_ == 0) return snapshot(collecting_ ? ServiceStatus::Collecting : ServiceStatus::Idle, false);

        if (now_ms - last_key_ms_ > timeout_ms_)
        {
            reset();
            return snapshot(ServiceStatus::TimedOut, false);
        }
        return snapshot(ServiceStatus::Collecting, false);
    }
}
