#!/usr/bin/env python3
"""Report mmWave presence from the HMMD sensor over UART as JSON lines.

The sensor emits lines such as:
    ON
    Range 126

A target closer than PRESENCE_THRESHOLD_CM is considered present. The
MagicMirror frontend already handles the 90-second delay before blanking the
screen, so this helper reports presence changes immediately.
"""

import json
import os
import re
import termios
import time


SERIAL_PORT = "/dev/ttyAMA0"
BAUD = termios.B115200
PRESENCE_THRESHOLD_CM = 180
RANGE_RE = re.compile(r"^Range\s+(\d+)\s*$", re.IGNORECASE)


last_state = None


def emit(present, distance=None):
    global last_state

    present = bool(present)

    if present == last_state:
        return

    last_state = present

    payload = {"present": present}
    if distance is not None:
        payload["distance_cm"] = int(distance)

    print(json.dumps(payload), flush=True)


def configure_serial(fd):
    attrs = termios.tcgetattr(fd)

    attrs[0] = 0
    attrs[1] = 0
    attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
    attrs[3] = 0
    attrs[4] = BAUD
    attrs[5] = BAUD

    attrs[6][termios.VMIN] = 1
    attrs[6][termios.VTIME] = 0

    termios.tcsetattr(fd, termios.TCSANOW, attrs)
    termios.tcflush(fd, termios.TCIFLUSH)


def main():
    fd = os.open(SERIAL_PORT, os.O_RDONLY | os.O_NOCTTY)

    try:
        configure_serial(fd)

        buffer = b""

        while True:
            chunk = os.read(fd, 256)

            if not chunk:
                time.sleep(0.05)
                continue

            buffer += chunk

            while b"\n" in buffer:
                raw_line, buffer = buffer.split(b"\n", 1)
                line = raw_line.decode("utf-8", errors="ignore").strip()

                match = RANGE_RE.match(line)
                if not match:
                    continue

                distance = int(match.group(1))
                emit(distance < PRESENCE_THRESHOLD_CM, distance)

    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
