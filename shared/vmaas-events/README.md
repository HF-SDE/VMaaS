# vmaas-events

The machine's offline event queue. An append-only journal of records plus a
cursor holding the highest sequence number the platform has acknowledged, so
an event survives both an offline period and a power cycle.

It performs no I/O itself. Everything goes through `FilePort` (`file_port.h`),
which is faked in the host tests and implemented over LittleFS in `vmaas-fs`.
That is what keeps the queue's logic - ordering, acknowledgement, compaction,
overflow and back-dating - testable with `pio test -e native`.

The on-disk format is one pipe-delimited record per line,
`seq|uptime_ms|wall_ms|type|payload_json`, documented in `record.h`. It is not
JSON, so this library needs no JSON parser; the payload is carried verbatim
and is opaque here.
