#include "crc8.h"

namespace vmaas
{
    uint8_t crc8(const uint8_t* data, size_t len)
    {
        uint8_t crc = 0x00;
        for (size_t i = 0; i < len; ++i)
        {
            crc ^= data[i];
            for (int bit = 0; bit < 8; ++bit)
            {
                if (crc & 0x80)
                    crc = static_cast<uint8_t>((crc << 1) ^ 0x07);
                else
                    crc = static_cast<uint8_t>(crc << 1);
            }
        }
        return crc;
    }
}
