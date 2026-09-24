#pragma once
/**
 * @file wiring_commit.h
 * @brief Turn a staged wiring table into the running one: serialise it as
 *        config.json v2, validate it with the boot parser and the board's
 *        reserved-pin check, write it atomically, hand back the parsed copy.
 */
#include <cstddef>
#include "protocol.h"
#include "slot_config.h"
#include "wiring_stager.h"

namespace wiring_commit
{
    /**
     * @brief Validate a staged table and, on success, make it the running one.
     * @param staged Table collected by WiringStager.
     * @param applied Receives the table as re-parsed from the written text, on success.
     * @param reason Receives a short cause on failure (fits config_store::LoadResult::reason).
     * @return true once /storage/config.json holds the new table.
     */
    bool commit_wiring(const vmaas::SlotConfig& staged, vmaas::SlotConfig& applied, char* reason, size_t cap);

    /// @brief The NAK code for a stager result that is not Ok.
    ///        BadSteps is a malformed COMMIT payload (BAD_PAYLOAD, per the spec);
    ///        a count mismatch is WRITE_FAILED; NotBegun is WIRING_STATE; Full is WIRING_FULL.
    vmaas::ErrorCode nak_for(vmaas::WiringStager::Result r);
}
