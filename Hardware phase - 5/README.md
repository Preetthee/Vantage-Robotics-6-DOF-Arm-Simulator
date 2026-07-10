# Phase 5 Hardware Controller

This folder contains the ESP32-based six-servo proof of concept. Its firmware (`sketch.ino`) uses a local Wi-Fi web server and a physical joystick to control the arm joints.

## Current hardware map

| Arm joint | Servo | ESP32 PWM GPIO |
|---|---:|---:|
| Base | Servo 1 | GPIO 13 |
| Shoulder | Servo 2 | GPIO 12 |
| Elbow | Servo 3 | GPIO 14 |
| Wrist pitch | Servo 4 | GPIO 27 |
| Wrist roll | Servo 5 | GPIO 26 |
| Stylus | Servo 6 | GPIO 25 |

| Joystick connection | ESP32 GPIO |
|---|---:|
| Horizontal output | GPIO 34 |
| Vertical output | GPIO 35 |
| Push button | GPIO 32 |
| VCC | 3.3 V |
| GND | GND |

## Power requirements

The Wokwi diagram powers the servos from the ESP32 5 V pin for simulation only. Do **not** do that with a physical six-servo arm.

- Use a separate regulated servo supply sized for the combined stall current of all six servos.
- Connect the servo supply ground to ESP32 ground so PWM signals have a common reference.
- Connect each servo signal wire to the GPIO listed above.
- Add a fuse and emergency stop to the servo supply path.
- Keep the ESP32 on USB or a separate regulated logic supply; never draw servo power through its USB connector or 5 V pin.

## Connecting the simulator to the physical arm

The firmware already exposes this local HTTP endpoint after joining Wi-Fi:

```text
GET http://<ESP32-IP>/set?servo=<0-5>&angle=<0-180>
```

Example: move the shoulder (servo index `1`) to 90 degrees:

```text
http://192.168.1.50/set?servo=1&angle=90
```

To connect the browser simulator:

1. Flash `sketch.ino` to the ESP32 and join it to the same Wi-Fi network as the computer running the simulator.
2. Open the serial monitor at 115200 baud and note the printed ESP32 IP address.
3. Add a hardware-bridge setting in the web app for that IP address.
4. When a simulator joint angle changes, convert radians to calibrated servo degrees and call the endpoint above.
5. Calibrate each joint separately: record its simulator zero angle, servo center, direction, and safe minimum/maximum degree limits. Do not assume every mechanical joint maps directly to 0–180 degrees.
6. Start at low speed with the arm unloaded, test one joint at a time, then enable multi-joint motion only after verifying limits and emergency stop behavior.

The current browser simulator intentionally remains simulation-only: no web request is sent to the ESP32 yet. This keeps the physical hardware disconnected until calibrated limits and a dedicated safety/interlock review are in place.

## Local joystick behavior

- Move joystick left/right: decrease/increase the selected servo angle.
- Move joystick up/down: select the next/previous servo.
- The firmware constrains each servo command to 0–180 degrees. Mechanical safe limits should still be calibrated per joint before use on the real arm.
