#include "config.h"

namespace vmaas
{
    const char* to_string(ConfigIssueKind kind)
    {
        switch (kind)
        {
        case ConfigIssueKind::None:          return "None";
        case ConfigIssueKind::InvalidJson:   return "InvalidJson";
        case ConfigIssueKind::MissingField:  return "MissingField";
        case ConfigIssueKind::WrongType:     return "WrongType";
        case ConfigIssueKind::OutOfRange:    return "OutOfRange";
        case ConfigIssueKind::InputOnlyPin:  return "InputOnlyPin";
        case ConfigIssueKind::DuplicateSlot: return "DuplicateSlot";
        case ConfigIssueKind::DuplicatePin:  return "DuplicatePin";
        case ConfigIssueKind::TooManySlots:  return "TooManySlots";
        case ConfigIssueKind::NewerVersion:  return "NewerVersion";
        }
        return "Unknown";
    }
}
