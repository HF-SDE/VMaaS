#pragma once
/**
 * @file crc8.h
 * @brief CRC-8 checksum used by the VMaaS frame format.
 */
#include <cstddef>
#include <cstdint>

namespace vmaas
{
    /**
     * @brief Implement the CRC-8 algorithm.
     * @details Compute the CRC-8 of a byte range.
     *
     * Parameters: polynomial 0x07, initial value 0x00, no input or output
     * reflection, no final XOR. Check value: CRC-8 of ASCII `"123456789"`
     * is 0xF4. The wire CRC covers LEN, CMD and PAYLOAD but not START.
     *
     * @param data First byte of the range. Never dereferenced when @p len is 0.
     * @param len Number of bytes to include.
     * @return The 8-bit checksum; 0x00 for an empty range.
     */
    uint8_t crc8(const uint8_t* data, size_t len);
}
