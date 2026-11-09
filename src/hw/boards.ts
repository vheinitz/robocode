// Symbolisches Board-/Pin-Modell. Beschreibt NUR, welche GPIOs es gibt und was
// sie koennen — keine echte Elektronik. Dient der Pin-Vergabe und der Pruefung,
// ob ein Gerät an einen Pin darf (z. B. AIN nur an ADC-faehige Pins).
//
// flashOffset: Offset fuer das MicroPython-Merged-Image beim Flashen (vgl.
// ../../espflasher). ESP32-C3/S3 (nativer USB): 0x0; klassischer ESP32: 0x1000.

export type Chip = 'esp32' | 'esp32c3' | 'esp32s3'

export interface PinDef {
  gpio: number
  /** ADC-faehig (nur ADC1-Pins, damit WLAN sie nicht blockiert). */
  adc?: boolean
  /** Nur Eingang — kein Ausgang/PWM moeglich. */
  inputOnly?: boolean
  /** Strapping-/Boot-Pin: nutzbar, aber mit Vorsicht (Warnung). */
  strapping?: boolean
  /** Reserviert (z. B. USB/UART0/Flash) — besser meiden. */
  reserved?: boolean
  note?: string
}

export interface Board {
  id: string
  name: string
  chip: Chip
  flashOffset: number
  defaultLed?: number
  pins: PinDef[]
}

// --- Klassischer ESP32 (WROOM-32, DevKitC) ---
const ESP32_WROOM: Board = {
  id: 'esp32-wroom-32',
  name: 'ESP32 DevKitC (WROOM-32)',
  chip: 'esp32',
  flashOffset: 0x1000,
  defaultLed: 2,
  pins: [
    { gpio: 0, strapping: true, note: 'Boot-Taster' },
    { gpio: 2, strapping: true, note: 'Onboard-LED' },
    { gpio: 4 },
    { gpio: 5, strapping: true },
    { gpio: 12, strapping: true, note: 'MTDI – Boot-Spannung' },
    { gpio: 13 },
    { gpio: 14 },
    { gpio: 15, strapping: true },
    { gpio: 16 },
    { gpio: 17 },
    { gpio: 18 },
    { gpio: 19 },
    { gpio: 21, note: 'SDA (I2C)' },
    { gpio: 22, note: 'SCL (I2C)' },
    { gpio: 23 },
    { gpio: 25 },
    { gpio: 26 },
    { gpio: 27 },
    { gpio: 32, adc: true },
    { gpio: 33, adc: true },
    { gpio: 34, adc: true, inputOnly: true },
    { gpio: 35, adc: true, inputOnly: true },
    { gpio: 36, adc: true, inputOnly: true, note: 'VP' },
    { gpio: 39, adc: true, inputOnly: true, note: 'VN' },
  ],
}

// --- ESP32-C3 (DevKitM / SuperMini), nativer USB ---
const ESP32_C3: Board = {
  id: 'esp32-c3',
  name: 'ESP32-C3 (nativer USB)',
  chip: 'esp32c3',
  flashOffset: 0x0,
  defaultLed: 8,
  pins: [
    { gpio: 0, adc: true },
    { gpio: 1, adc: true },
    { gpio: 2, adc: true, strapping: true },
    { gpio: 3, adc: true },
    { gpio: 4, adc: true },
    { gpio: 5 },
    { gpio: 6 },
    { gpio: 7 },
    { gpio: 8, strapping: true, note: 'oft Onboard-LED' },
    { gpio: 9, strapping: true, note: 'Boot-Taster' },
    { gpio: 10 },
    { gpio: 18, reserved: true, note: 'USB D-' },
    { gpio: 19, reserved: true, note: 'USB D+' },
    { gpio: 20, reserved: true, note: 'UART0 RX' },
    { gpio: 21, reserved: true, note: 'UART0 TX' },
  ],
}

export const BOARDS: Board[] = [ESP32_C3, ESP32_WROOM]

export function getBoard(id: string): Board {
  return BOARDS.find((b) => b.id === id) ?? BOARDS[0]
}

export function pinDef(board: Board, gpio: number): PinDef | undefined {
  return board.pins.find((p) => p.gpio === gpio)
}

export function canOutput(p: PinDef): boolean {
  return !p.inputOnly && !p.reserved
}
export function canPwm(p: PinDef): boolean {
  return !p.inputOnly && !p.reserved
}
export function canAdc(p: PinDef): boolean {
  return !!p.adc && !p.reserved
}
