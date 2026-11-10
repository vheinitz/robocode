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

export interface Board {
  id: string
  name: string
  chip: string
  flashOffset: number // C3/S3: Merged-Bin @0x0
  pins: PinDef[]
  /** Arduino-artige Baenke: Index -> GPIO. DO0.. / DI0.. / A0.. werden vorab
   *  als Objekte erzeugt und stehen im Namensraum (willkuerliche Aufteilung;
   *  wenige DIs, weil A-Pins ebenfalls digital lesbar sind). */
  banks: { do: number[]; di: number[]; a: number[] }
}

export const BOARDS: Board[] = [
  {
    id: 'esp32c3',
    name: 'ESP32-C3',
    chip: 'esp32c3',
    flashOffset: 0x0,
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
    name: 'ESP32-S3',
    chip: 'esp32s3',
    flashOffset: 0x0,
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
]

export function getBoard(id: string): Board {
  return BOARDS.find((b) => b.id === id) ?? BOARDS[0]
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
