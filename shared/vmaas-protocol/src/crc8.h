#pragma once
#include <cstddef>
#include <cstdint>

namespace vmaas
{
    /**
   * @brief Implement the CRC-8 algorithm.
   * @param data Pointer to the first byte. Never dereferenced when len is 0.
   * @param len  Number of bytes to include.
   * @return CRC-8 with polynomial 0x07, init 0x00, no reflection, no final XOR.
   */
    uint8_t crc8(const uint8_t* data, size_t len);
}
