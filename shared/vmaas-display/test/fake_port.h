#pragma once
/**
 * @file fake_port.h
 * @brief Recording LcdPort for the host tests. Included from each test folder as "../fake_port.h".
 *
 * Every write() and delay_ms() is appended to `events` in call order, so a
 * test can assert the exact byte sequence and timing the driver produced.
 * Failure injection: nak(addr) makes an address never acknowledge (like a
 * missing chip), fail_next(n) fails the next n calls, fail_write_at(i) fails
 * the i-th acknowledged write (0-based). Failed writes are not recorded.
 * probe() follows nak() only (every other address is present), is logged in
 * `probes` and never appears in `events`.
 */
#include <cstdint>
#include <initializer_list>
#include <set>
#include <vector>
#include "lcd_port.h"

struct Event
{
    enum Kind { Write, Delay } kind;
    uint8_t addr;               // valid for Write
    std::vector<uint8_t> bytes; // valid for Write
    uint32_t ms;                // valid for Delay
};

class FakePort : public vmaas::LcdPort
{
public:
    std::vector<Event> events;
    std::set<uint8_t> nak_addrs;   // addresses that never ACK
    int fail_next_count = 0;       // fail this many upcoming writes, then succeed
    int fail_write_index = -1;     // fail the Nth non-NAK write (0-based), then succeed
    int attempted_write_count = 0; // count of write() calls that got past the NAK check
    std::vector<uint8_t> probes;   // every probe() address, in call order

    bool write(uint8_t addr, const uint8_t* data, size_t len) override
    {
        if (nak_addrs.count(addr) != 0) return false;
        const int index = attempted_write_count++;
        if (fail_next_count > 0) {
            --fail_next_count;
            return false;
        }
        if (index == fail_write_index) return false;
        events.push_back(Event{Event::Write, addr, std::vector<uint8_t>(data, data + len), 0});
        return true;
    }

    bool probe(uint8_t addr) override
    {
        probes.push_back(addr);
        return nak_addrs.count(addr) == 0;
    }

    void delay_ms(uint32_t ms) override
    {
        events.push_back(Event{Event::Delay, 0, {}, ms});
    }

    void nak(uint8_t addr) { nak_addrs.insert(addr); }
    void fail_next(int n) { fail_next_count = n; }
    void fail_write_at(int index) { fail_write_index = index; }
    void clear() { events.clear(); }

    std::vector<std::vector<uint8_t>> writes_to(uint8_t addr) const
    {
        std::vector<std::vector<uint8_t>> out;
        for (const Event& e : events) {
            if (e.kind == Event::Write && e.addr == addr) {
                out.push_back(e.bytes);
            }
        }
        return out;
    }

    size_t write_count() const
    {
        size_t n = 0;
        for (const Event& e : events) {
            if (e.kind == Event::Write) {
                ++n;
            }
        }
        return n;
    }
};

// Convenience for asserting one write.
inline bool bytes_equal(const std::vector<uint8_t>& v, std::initializer_list<uint8_t> expected)
{
    return v == std::vector<uint8_t>(expected);
}
