/**
 * @file wiring_sender.cpp
 * @brief See wiring_sender.h.
 */
#include "wiring_sender.h"

namespace vmaas
{
    WiringStep WiringSender::start(const WiringTable& table, uint32_t now_ms)
    {
        phase_ = Phase::Idle;
        attempts_ = 0;

        bool ok = table.steps_per_vend != 0 && table.row_count > 0 && table.row_count <= WIRING_MAX_ROWS;
        for (uint8_t i = 0; ok && i < table.row_count; ++i) {
            ok = table.rows[i].pin_count > 0 && table.rows[i].pin_count <= WIRING_MAX_PINS;
        }
        if (!ok)
        {
            WiringStep s;
            s.kind = WiringStep::Kind::Failed;
            s.failure = WiringFailure::BadTable;
            return s;
        }

        table_ = table;
        attempts_ = 1;
        return send_begin(now_ms);
    }

    WiringStep WiringSender::on_ack(Cmd acked, uint32_t now_ms)
    {
        if (phase_ != Phase::Awaiting || acked != awaiting_) return wait();

        switch (acked)
        {
        case Cmd::WIRING_BEGIN:
            next_row_ = 0;
            return send_row(now_ms);
        case Cmd::WIRING_SLOT:
            ++next_row_;
            return next_row_ < table_.row_count ? send_row(now_ms) : send_commit(now_ms);
        case Cmd::WIRING_COMMIT:
        {
            phase_ = Phase::Idle;
            WiringStep s;
            s.kind = WiringStep::Kind::Done;
            return s;
        }
        default:
            return wait();
        }
    }

    WiringStep WiringSender::on_nak(Cmd rejected, ErrorCode err, uint32_t now_ms)
    {
        if (phase_ != Phase::Awaiting || rejected != awaiting_) return wait();

        if (rejected == Cmd::WIRING_COMMIT && err == ErrorCode::BUSY)
        {
            if (!busy_seen_)
            {
                busy_seen_ = true;
                busy_first_ms_ = now_ms;
            }
            if (now_ms - busy_first_ms_ >= BUSY_GIVE_UP_MS) {
                return restart(now_ms, WiringFailure::Nak, err);
            }
            phase_ = Phase::BusyWait;
            busy_wait_from_ms_ = now_ms;
            return wait();
        }

        return restart(now_ms, WiringFailure::Nak, err);
    }

    WiringStep WiringSender::tick(uint32_t now_ms)
    {
        if (phase_ == Phase::BusyWait && now_ms - busy_wait_from_ms_ >= BUSY_RETRY_MS) {
            return send_commit(now_ms);
        }
        if (phase_ == Phase::Awaiting && now_ms - sent_at_ms_ >= REPLY_TIMEOUT_MS) {
            return restart(now_ms, WiringFailure::NoReply, ErrorCode::UNKNOWN_CMD);
        }
        return wait();
    }

    WiringStep WiringSender::send(const Frame& f, uint32_t now_ms)
    {
        phase_ = Phase::Awaiting;
        awaiting_ = f.cmd;
        sent_at_ms_ = now_ms;

        WiringStep s;
        s.kind = WiringStep::Kind::Send;
        s.frame = f;
        return s;
    }

    WiringStep WiringSender::send_begin(uint32_t now_ms)
    {
        next_row_ = 0;
        busy_seen_ = false;
        return send(frames::wiring_begin(), now_ms);
    }

    WiringStep WiringSender::send_row(uint32_t now_ms)
    {
        const WiringRow& r = table_.rows[next_row_];
        return send(frames::wiring_slot(r.slot, r.pins, r.pin_count), now_ms);
    }

    WiringStep WiringSender::send_commit(uint32_t now_ms)
    {
        return send(frames::wiring_commit(table_.row_count, table_.steps_per_vend), now_ms);
    }

    WiringStep WiringSender::restart(uint32_t now_ms, WiringFailure why, ErrorCode nak)
    {
        if (attempts_ >= MAX_ATTEMPTS)
        {
            phase_ = Phase::Idle;
            WiringStep s;
            s.kind = WiringStep::Kind::Failed;
            s.failure = why;
            s.nak = nak;
            return s;
        }
        ++attempts_;
        return send_begin(now_ms);
    }
}
