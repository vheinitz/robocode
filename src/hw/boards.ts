// Board-Modell: welche GPIOs auf dem gewählten ESP32 nutzbar sind und welche
// ADC-fähig. Daraus erzeugt der Assembler die vordefinierten Pin-Objekte
// (D<gpio> für alle, A<gpio> für ADC-Pins) in der versteckten DSL.
//
// HINWEIS: Die Listen sind ein bewusst konservativer, nutzbarer Ausschnitt
// (ohne Flash/PSRAM/USB-Pins). Strapping-/Boot-Pins sind markiert — nutzbar,
// können aber den Start stören. Bei Bedarf verfeinern.

export interface PinDef {
  gpio: number
  adc?: boolean       // ADC1-fähig
  strapping?: boolean // Boot-/Strapping-Pin (Warnung)
  note?: string
}

/** Bedeutung eines Pins in der Projekt-Belegung (0.2). */
export type PinRole = 'A' | 'DI' | 'DO' | 'SDA' | 'SCL' | 'SPI' | 'INT' | 'none'

export const ROLE_LABEL: Record<PinRole, string> = {
  A: 'Analog-Eingang', DI: 'Digital-Eingang', DO: 'Digital-Ausgang',
  SDA: 'I²C SDA', SCL: 'I²C SCL', SPI: 'SPI', INT: 'Interrupt', none: '—',
}

export interface Board {
  id: string
  name: string
  chip: string
  flashOffset: number // C3/S3: Merged-Bin @0x0
  /** Bild des Boards (unter public/boards/), für die Board-Ansicht. */
  image?: string
  pins: PinDef[]
  /** Arduino-artige Baenke: Index -> GPIO. DO0.. / DI0.. / A0.. werden vorab
   *  als Objekte erzeugt und stehen im Namensraum (willkuerliche Aufteilung;
   *  wenige DIs, weil A-Pins ebenfalls digital lesbar sind). */
  banks: { do: number[]; di: number[]; a: number[] }
}

export const BOARDS: Board[] = [
  {
    id: 'esp32c3',
    name: 'ESP32-C3 SuperMini',
    chip: 'esp32c3',
    flashOffset: 0x0,
    image: 'boards/esp32-c3-supermini.png',
    pins: [
      { gpio: 0, adc: true },
      { gpio: 1, adc: true },
      { gpio: 2, adc: true, strapping: true, note: 'Boot-Strapping' },
      { gpio: 3, adc: true },
      { gpio: 4, adc: true },
      { gpio: 5 },
      { gpio: 6 },
      { gpio: 7 },
      { gpio: 8, strapping: true, note: 'Boot-Strapping (LED on manchen Boards)' },
      { gpio: 9, strapping: true, note: 'Boot-Strapping (BOOT-Taste)' },
      { gpio: 10 },
      { gpio: 20 },
      { gpio: 21 },
    ],
    // DO0..5 = GPIO5..10, DI0..1 = GPIO20..21, A0..4 = GPIO0..4 (A0..4 == gpio).
    banks: { do: [5, 6, 7, 8, 9, 10], di: [20, 21], a: [0, 1, 2, 3, 4] },
  },
  {
    id: 'esp32s3',
    name: 'ESP32-S3 SuperMini',
    chip: 'esp32s3',
    flashOffset: 0x0,
    image: 'boards/esp32-s3-supermini.png',
    pins: [
      { gpio: 1, adc: true },
      { gpio: 2, adc: true },
      { gpio: 3, adc: true, strapping: true, note: 'Strapping' },
      { gpio: 4, adc: true },
      { gpio: 5, adc: true },
      { gpio: 6, adc: true },
      { gpio: 7, adc: true },
      { gpio: 8, adc: true },
      { gpio: 9, adc: true },
      { gpio: 10, adc: true },
      { gpio: 11 },
      { gpio: 12 },
      { gpio: 13 },
      { gpio: 14 },
      { gpio: 15 },
      { gpio: 16 },
      { gpio: 17 },
      { gpio: 18 },
      { gpio: 21 },
      { gpio: 38 },
      { gpio: 39 },
      { gpio: 40 },
      { gpio: 41 },
      { gpio: 42 },
      { gpio: 47 },
      { gpio: 48 },
    ],
    banks: { do: [11, 12, 13, 14, 15, 16], di: [17, 18], a: [1, 2, 3, 4, 5] },
  },
  {
    // Wie C3 SuperMini, aber mit onboard-OLED 0.42" (SSD1306, I²C auf GPIO5/6).
    // Deshalb GPIO5/6 nicht in den DO-Baenken (fuer das Display reserviert).
    id: 'esp32c3oled',
    name: 'ESP32-C3 SuperMini OLED',
    chip: 'esp32c3',
    flashOffset: 0x0,
    image: 'boards/esp32-c3-supermini-oled-042.png',
    pins: [
      { gpio: 0, adc: true },
      { gpio: 1, adc: true },
      { gpio: 2, adc: true, strapping: true, note: 'Boot-Strapping' },
      { gpio: 3, adc: true },
      { gpio: 4, adc: true },
      { gpio: 5, note: 'OLED SDA (I²C)' },
      { gpio: 6, note: 'OLED SCL (I²C)' },
      { gpio: 7 },
      { gpio: 8, strapping: true, note: 'Boot-Strapping (LED on manchen Boards)' },
      { gpio: 9, strapping: true, note: 'Boot-Strapping (BOOT-Taste)' },
      { gpio: 10 },
      { gpio: 20 },
      { gpio: 21 },
    ],
    banks: { do: [7, 8, 9, 10], di: [20, 21], a: [0, 1, 2, 3, 4] },
  },
]

export function getBoard(id: string): Board {
  return BOARDS.find((b) => b.id === id) ?? BOARDS[0]
}

/** Pin-Beschreibung mit Default-Name/Rolle (A0.., DI0.., DO0.., sonst GPIOn). */
export interface PinDesc {
  gpio: number
  name: string
  role: PinRole
  adc: boolean
  note?: string
}

/** Standard-Belegung eines Boards: Bank-Index -> Default-Name/Rolle. */
export function defaultPins(board: Board): PinDesc[] {
  return board.pins.map((p) => {
    const ia = board.banks.a.indexOf(p.gpio)
    const ido = board.banks.do.indexOf(p.gpio)
    const idi = board.banks.di.indexOf(p.gpio)
    if (ia >= 0) return { gpio: p.gpio, name: `A${ia}`, role: 'A' as PinRole, adc: !!p.adc, note: p.note }
    if (ido >= 0) return { gpio: p.gpio, name: `DO${ido}`, role: 'DO' as PinRole, adc: !!p.adc, note: p.note }
    if (idi >= 0) return { gpio: p.gpio, name: `DI${idi}`, role: 'DI' as PinRole, adc: !!p.adc, note: p.note }
    // OLED-Pins als I²C vorbelegen, sonst ungenutzt.
    if (p.note?.includes('SDA')) return { gpio: p.gpio, name: 'sda', role: 'SDA' as PinRole, adc: !!p.adc, note: p.note }
    if (p.note?.includes('SCL')) return { gpio: p.gpio, name: 'scl', role: 'SCL' as PinRole, adc: !!p.adc, note: p.note }
    return { gpio: p.gpio, name: `GPIO${p.gpio}`, role: 'none' as PinRole, adc: !!p.adc, note: p.note }
  })
}

/** Gueltiger Python-Bezeichner? (fuer eigene Pin-Namen) */
export function isValidName(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)
}

/** Vordefinierte Zeilen aus einer EIGENEN Pin-Belegung (Projekt-Klon, 0.2).
 *  alias = Konstruktor; nur A/DI/DO erzeugen direkt nutzbare Objekte. */
export function customPinLines(pins: PinDesc[]): string {
  const ctor: Partial<Record<PinRole, (g: number) => string>> = {
    A: (g) => `AI(${g})`,
    DI: (g) => `DI(${g})`,
    DO: (g) => `DO(${g})`,
  }
  const body = pins
    .filter((p) => isValidName(p.name) && ctor[p.role])
    .map((p) => `${p.name} = ${ctor[p.role]!(p.gpio)}`)
  const i2c = pins.filter((p) => p.role === 'SDA' || p.role === 'SCL')
  const lines = ['# ----- Eigene Pin-Namen (Board fuer dieses Projekt angepasst) -----']
  if (i2c.length) {
    const sda = i2c.find((p) => p.role === 'SDA')
    const scl = i2c.find((p) => p.role === 'SCL')
    lines.push(`# I2C: SDA=GPIO${sda?.gpio ?? '?'}, SCL=GPIO${scl?.gpio ?? '?'} (fuer Display/Sensor)`)
  }
  lines.push(...(body.length ? body : ['# (keine eigenen Namen vergeben)']))
  return lines.join('\n')
}

/** Vordefinierte Objekte für die versteckte DSL. Das Board-Objekt `b` trägt die
 *  klammerlose Kurzsprache (b.do1 = 1 / t = b.a1); daneben die direkten
 *  GPIO-Namen D<gpio> für Fortgeschrittene. */
export function predefinedPinLines(board: Board): string {
  const arr = (xs: number[]) => `[${xs.join(', ')}]`
  const { do: dos, di: dis, a: ais } = board.banks
  const d = board.pins.map((p) => `D${p.gpio} = D(${p.gpio})`)
  const chunk = (a: string[], n: number): string[] => {
    const out: string[] = []
    for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n).join('; '))
    return out
  }
  return [
    '# Board `b` — schon da, bevor MAIN laeuft:',
    '#   Ausgang:  b.do1 = 1   (0/1 = an/aus, jede andere Zahl = PWM 0..255)',
    '#   Eingang:  t = b.a1    if b.di0:',
    `b = Board(${arr(dos)}, ${arr(dis)}, ${arr(ais)})`,
    '# Direkt per GPIO (fortgeschritten): D<gpio>',
    ...chunk(d, 4),
  ].join('\n')
}
