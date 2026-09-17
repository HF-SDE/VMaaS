# vmaas-fs

LittleFS mounting and whole-file text reading.

```c++
#include "storage.h"

if (vmaas::fs::mount("storage", "/storage"))
{
    static char text[2048];
    const int n = vmaas::fs::read_text_file("/storage/config.json", text, sizeof(text));
    // n >= 0: bytes read.  -1: cannot open or read.  -2: does not fit.
}
```

`mount()` never formats. A partition that will not mount is fault,
not to damage to go over - the caller decides what to do about it, and both
controllers currently log and fall back to their own defaults.

`read_text_file()` rejects a file larger than the buffer rather than shortening it.

## No host tests

This library is ESP-IDF only and has no `platform = native` suite. Both
functions are thin wrappers over `esp_littlefs` and stdio, so a mock of them
would test the mock. They are covered on hardware by the config-loading checks
in each firmware: a good file, a missing file, a malformed file, and a file
larger than the buffer.
