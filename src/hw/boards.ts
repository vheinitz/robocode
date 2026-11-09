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
  },
]

export function getBoard(id: string): Board {
  return BOARDS.find((b) => b.id === id) ?? BOARDS[0]
}

/** Vordefinierte Pin-Objekte für die versteckte DSL: D<gpio> für jeden Pin,
 *  A<gpio> zusätzlich für ADC-Pins. Kompakt, mehrere pro Zeile. */
export function predefinedPinLines(board: Board): string {
  const d = board.pins.map((p) => `D${p.gpio} = D(${p.gpio})`)
  const a = board.pins.filter((p) => p.adc).map((p) => `A${p.gpio} = AI(${p.gpio})`)
  const chunk = (arr: string[], n: number): string[] => {
    const out: string[] = []
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n).join('; '))
    return out
  }
  return [`# Digital-Pins (D<gpio>):`, ...chunk(d, 4), `# Analog-Pins (A<gpio>):`, ...chunk(a, 4)].join('\n')
}
