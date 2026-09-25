/**
 * GPIO facts about the ESP32-WROOM Motorcontrol board that both the backend
 * and the admin UI have to agree on. Mirrors the firmware's own checks in
 * `shared/vmaas-config/src/slot_config.h` (the 0-33 output range),
 * `Motorcontrol/src/config_store.cpp` (the reserved set) and
 * `Motorcontrol/src/pins.h` (the board's own GPIOs), so a value the device
 * would refuse at boot is refused here first.
 */

/** GPIO 34-39 are input-only and cannot drive nENABLE. */
export const MAX_OUTPUT_GPIO = 33;

/**
 * Pins no slot may drive on any board: the console UART0 (1, 3) and the SPI
 * flash (6-11). Resetting a flash line at boot bricks the board until it is
 * reflashed. The board-specific ones (the shared STEP line and the UART to
 * Main-Controller) are a separate set below, since they are specific to the
 * Motorcontrol board rather than the ESP32 in general.
 */
export const RESERVED_GPIOS: readonly number[] = [1, 3, 6, 7, 8, 9, 10, 11];

export function isReservedGpio(number: number): boolean {
  return RESERVED_GPIOS.includes(number);
}

export const RESERVED_GPIO_MESSAGE = "GPIO 1, 3 and 6-11 are the console and flash lines and cannot drive a motor";

/**
 * GPIOs the Motorcontrol board itself uses, from `Motorcontrol/src/pins.h`:
 * 4 is the shared STEP line, 16/17 the UART to Main-Controller. A slot on one
 * of these puts the board into config-error at boot. Keep in step with pins.h.
 */
export const MOTORCONTROL_BOARD_GPIOS: readonly number[] = [4, 16, 17];

export function isBoardGpio(number: number): boolean {
  return MOTORCONTROL_BOARD_GPIOS.includes(number);
}

export const BOARD_GPIO_MESSAGE =
  "GPIO 4, 16 and 17 are the STEP line and the UART on the motor board and cannot drive a motor";

/**
 * STEP pulses Motorcontrol emits per vend. Sent to the device as a u16 in
 * WIRING_COMMIT and stored in its config.json as motor.stepsPerVend, so the
 * bounds are the wire's, not a preference. 6400 is one revolution of a
 * 200-step motor at 1/32 microstepping.
 */
export const STEPS_PER_VEND_MIN = 1;
export const STEPS_PER_VEND_MAX = 65535;
export const STEPS_PER_VEND_DEFAULT = 6400;
