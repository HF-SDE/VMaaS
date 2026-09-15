#pragma once
/**
 * @file frame_codec.h
 * @brief Conversion between vmaas::Frame and the bytes on the wire.
 *
 * No hardware dependency; this layer is unit-tested on the host. The frame
 * layout is `[START][LEN][CMD][PAYLOAD ...][CRC]`, see PROTOCOL.md.
 */
#include <cstddef>
#include <cstdint>
#include "protocol.h"

namespace vmaas
{
    /**
     * @brief Serialise a frame into a byte buffer.
     * @param f Frame to encode.
     * @param out Destination buffer.
     * @param out_size Capacity of @p out in bytes.
     * @return Number of bytes written (4 + f.len), or 0 if f.len exceeds
     *         MAX_PAYLOAD or @p out_size is too small.
     */
    size_t encode(const Frame& f, uint8_t* out, size_t out_size);

    /**
     * @brief Byte-at-a-time frame parser.
     *
     * Feed every received byte to feed(). When a complete, CRC-valid frame has
     * been assembled the call returns true and fills the output frame.
     * Invalid input (LEN > MAX_PAYLOAD, bad CRC) silently resets the parser
     * and increments dropped_frames(), then parsing resumes from the next
     * START byte.
     */
    class FrameParser
    {
    public:
        /**
         * @brief Consume one received byte.
         * @param byte The byte just read from the UART.
         * @param out Filled with the decoded frame when the call returns true.
         * @return true exactly once per complete, CRC-valid frame.
         */
        bool feed(uint8_t byte, Frame& out);

        /// @brief Discard any partially parsed frame and wait for the next START byte.
        void reset();

        /// @brief Number of frames dropped because of a bad LEN or CRC since construction.
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
