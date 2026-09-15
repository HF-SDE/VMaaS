#include "frame_codec.h"
#include "crc8.h"

namespace vmaas
{
    size_t encode(const Frame& f, uint8_t* out, size_t out_size)
    {
        if (f.len > MAX_PAYLOAD)
            return 0;
        const size_t total = 4 + f.len;
        if (out_size < total)
            return 0;

        out[0] = FRAME_START;
        out[1] = f.len;
        out[2] = static_cast<uint8_t>(f.cmd);
        for (uint8_t i = 0; i < f.len; ++i)
            out[3 + i] = f.payload[i];
        // CRC covers LEN, CMD and PAYLOAD: bytes 1 .. 2+len
        out[3 + f.len] = crc8(&out[1], 2 + f.len);
        return total;
    }

    bool FrameParser::feed(uint8_t byte, Frame& out)
    {
        switch (stage_)
        {
        case Stage::WAIT_START:
            if (byte == FRAME_START)
                stage_ = Stage::READ_LEN;
            return false;

        case Stage::READ_LEN:
            if (byte > MAX_PAYLOAD)
            {
                ++dropped_;
                reset();
                return false;
            }
            current_.len = byte;
            stage_ = Stage::READ_CMD;
            return false;

        case Stage::READ_CMD:
            current_.cmd = static_cast<Cmd>(byte);
            payload_index_ = 0;
            stage_ = (current_.len == 0) ? Stage::READ_CRC : Stage::READ_PAYLOAD;
            return false;

        case Stage::READ_PAYLOAD:
            current_.payload[payload_index_++] = byte;
            if (payload_index_ == current_.len)
                stage_ = Stage::READ_CRC;
            return false;

        case Stage::READ_CRC:
        {
            // Rebuild the CRC input: LEN, CMD, PAYLOAD.
            uint8_t header[2 + MAX_PAYLOAD];
            header[0] = current_.len;
            header[1] = static_cast<uint8_t>(current_.cmd);
            for (uint8_t i = 0; i < current_.len; ++i)
                header[2 + i] = current_.payload[i];
            const bool ok = (crc8(header, 2 + current_.len) == byte);
            if (ok)
                out = current_;
            else
                ++dropped_;
            reset();
            return ok;
        }
        }
        return false;
    }

    void FrameParser::reset()
    {
        stage_ = Stage::WAIT_START;
        payload_index_ = 0;
        current_ = Frame{};
    }
}
