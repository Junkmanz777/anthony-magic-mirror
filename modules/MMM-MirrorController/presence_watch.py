#!/usr/bin/env python3
"""Report mmWave presence changes from GPIO27 as JSON lines."""

import json
import signal

from gpiozero import DigitalInputDevice


sensor = DigitalInputDevice(27, pull_up=None, active_state=True)
last_state = None


def emit(present):
    global last_state

    present = bool(present)

    if present == last_state:
        return

    last_state = present
    print(json.dumps({"present": present}), flush=True)


sensor.when_activated = lambda: emit(True)
sensor.when_deactivated = lambda: emit(False)

emit(sensor.is_active)
signal.pause()
