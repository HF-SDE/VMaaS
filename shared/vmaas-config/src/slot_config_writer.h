#pragma once
/**
 * @file slot_config_writer.h
 * @brief Serialise a SlotConfig as config.json schema v2, the exact shape
 *        parse_slot_config() reads and the backend publishes.
 */
#include <cstddef>
#include "slot_config.h"

namespace vmaas
{
    /**
     * @brief Write @p cfg to @p out as compact JSON, NUL-terminated.
     * @return Bytes written excluding the NUL, or -1 when @p cap is too small
     *         (then out[0] == '\0'). Never allocates.
     */
    int write_slot_config_json(const SlotConfig& cfg, char* out, size_t cap);
}
