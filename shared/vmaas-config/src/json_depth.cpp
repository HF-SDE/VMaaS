#include "json_depth.h"

namespace vmaas
{
    bool nesting_too_deep(const char* text, size_t& offset)
    {
        int depth = 0;
        bool in_string = false;
        bool escaped = false;
        for (size_t i = 0; text[i] != '\0'; ++i)
        {
            const char c = text[i];
            if (in_string)
            {
                if (escaped) {
                    escaped = false;
                }
                else if (c == '\\') {
                    escaped = true;
                }
                else if (c == '"') {
                    in_string = false;
                }
                continue;
            }
            if (c == '"')
            {
                in_string = true;
            }
            else if (c == '{' || c == '[')
            {
                if (++depth > MAX_NESTING_DEPTH)
                {
                    offset = i;
                    return true;
                }
            }
            else if (c == '}' || c == ']')
            {
                if (depth > 0)
                    --depth;
            }
        }
        return false;
    }
}
