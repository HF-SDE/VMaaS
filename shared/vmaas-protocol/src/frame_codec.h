#pragma once
// Frame <-> bytes. No hardware dependency; unit-tested on the host.
#include <cstddef>
#include <cstdint>
#include "protocol.h"

namespace vmaas
{
    // Serialises f into out. Returns the number of bytes written
    // (4 + f.len), or 0 if f.len > MAX_PAYLOAD or out_size is too small.
    size_t encode(const Frame& f, uint8_t* out, size_t out_size);

    // Byte-at-a-time parser. Feed every received byte; when a complete,
    // CRC-valid frame has been assembled, feed() returns true and fills out.
    // Invalid input (LEN > MAX_PAYLOAD, bad CRC) silently resets the parser
    // and increments dropped_frames().
    class FrameParser
    {
    public:
        bool feed(uint8_t byte, Frame& out);
        void reset();
        uint32_t dropped_frames() const { return dropped_; }

    private:
        enum class Stage : uint8_t
        {
            WAIT_START,
            READ_LEN,
            READ_CMD,
            READ_PAYLOAD,
            READ_CRC,
        };

        Stage stage_ = Stage::WAIT_START;
        Frame current_{};
        uint8_t payload_index_ = 0;
        uint32_t dropped_ = 0;
    };
}
