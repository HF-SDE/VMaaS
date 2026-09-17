#pragma once
/**
 * @file entry_state.h
 * @brief What a slot entry looks like from the outside.
 *
 * EntryState is a value, not a handle: handle() and tick() return one by
 * copy. Confirmed, Cancelled and TimedOut are transient - they are reported
 * once, and the SlotEntry that produced them is already back to an empty
 * Editing state by the time the caller sees them. That is why slot_number()
 * is a free function over the returned value rather than a member.
 */
#include <cstdint>

namespace vmaas
{
    /// Where an entry stands.
    enum class EntryStatus : uint8_t
    {
        Editing = 0, /// Buffer may be empty or partial; nothing decided.
        Confirmed,   /// User pressed '#' on a non-empty buffer.
        Cancelled,   /// User backed out of an empty buffer.
        TimedOut,    /// No key for the timeout window; buffer was discarded.
    };

    /// Maximum digits an entry can hold.
    inline constexpr uint8_t SLOT_ENTRY_MAX_DIGITS = 2;
    /// Milliseconds of inactivity before a partial entry is discarded.
    inline constexpr uint32_t SLOT_ENTRY_TIMEOUT_MS = 10000;

    /// A snapshot of an entry: what is typed, and what just happened.
    struct EntryState
    {
        char buffer[SLOT_ENTRY_MAX_DIGITS + 1]; /// NUL-terminated digits.
        EntryStatus status;                     /// What just happened.
    };

    /**
     * @brief Human-readable name of a status.
     * @param s Status to name.
     * @return Static string such as "Confirmed"; "Unknown" outside the enum.
     */
    const char* to_string(EntryStatus s);

    /**
     * @brief Parse the buffer of a state into a slot number.
     * @param st State to read.
     * @param out Receives the parsed number when the call succeeds.
     * @return false when the buffer is empty or holds a non-digit.
     */
    bool slot_number(const EntryState& st, uint8_t& out);
}
