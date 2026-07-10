# Phase 5 - 6-DOF Arm Electrical PoC

The [schematic](../public/electrical-schematic.svg) shows a safe proof-of-concept control architecture for six servos and a Wi-Fi-connected controller. It is intentionally a diagram and wiring specification, not a generated Wokwi project file.

## Power and safety

| Circuit | Source | Purpose |
|---|---|---|
| 12 V input | Fused 12 V DC supply | Main distribution; place a 20 A fuse and emergency stop close to the source. |
| 6 V servo rail | High-current 12 V to 6 V buck converter | PCA9685 `V+` and servo red wires. Size it above the combined expected stall current. |
| 5 V logic rail | Separate 12 V to 5 V buck converter | ESP32 `VIN` / 5 V input. |
| Ground | Shared return | Connect supply, both buck converters, ESP32, PCA9685, and every servo ground. |

Never power the six servos from the ESP32 or its USB port. Add bulk capacitance near the PCA9685 servo-power input and use appropriately rated wire/connectors.

## Controller connections

| ESP32 pin | PCA9685 pin | Purpose |
|---|---|---|
| GPIO 21 | SDA | I2C data |
| GPIO 22 | SCL | I2C clock |
| 3.3 V | VCC | PWM-driver logic supply |
| GND | GND | Logic reference |
| Wi-Fi | Browser/control service | Remote command link; no extra radio module is required. |

Connect PCA9685 outputs CH0 through CH5 to servo signal wires for joints J1 through J6. Each servo's red wire goes to the 6 V rail and black/brown wire to common ground.

## Validation before hardware use

1. Test the ESP32 and PCA9685 with servos disconnected.
2. Verify I2C discovery and PWM pulses on one channel with an oscilloscope/logic analyzer.
3. Add one servo at a time with a current-limited power supply.
4. Confirm emergency-stop disconnects servo power while logic remains available for diagnostics.
