"""Reset the ESP32 on a COM port and print its serial output for N seconds.

Usage: python tools/capture_serial.py COM6 8
`pio device monitor` needs a TTY; this works from any shell. Uses pyserial,
which ships with PlatformIO's penv python, and is safe on any console encoding:
undecodable serial noise and characters the console cannot show are escaped
instead of raising.
"""
import codecs
import sys
import time

import serial

# Reset-time line noise decodes to characters a cp1252 console cannot encode;
# escape them rather than let sys.stdout.write raise UnicodeEncodeError.
sys.stdout.reconfigure(errors="backslashreplace")


def main() -> int:
    port = sys.argv[1] if len(sys.argv) > 1 else "COM6"
    seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 8.0
    # Incremental so a multi-byte UTF-8 sequence split across two reads still decodes.
    dec = codecs.getincrementaldecoder("utf-8")(errors="replace")
    with serial.Serial(port, 115200, timeout=0.2) as s:
        # Pulse EN via RTS with IO0 (DTR) released: normal reset, not bootloader.
        s.setDTR(False)
        s.setRTS(True)
        time.sleep(0.1)
        s.setRTS(False)
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            chunk = s.read(4096)
            if chunk:
                sys.stdout.write(dec.decode(chunk))
                sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
