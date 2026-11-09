// Geräte-Modell: die vier HW-Block-Typen, ihre Pin-Slots, ihr Methoden-Vokabular
// und die Zuordnung Block -> Python-Instanz (Namenskonvention).

import { Board, PinDef, pinDef, canOutput, canPwm, canAdc } from './boards'

export type DeviceType = 'button' | 'led' | 'din' | 'dout' | 'light' | 'ain' | 'poti' | 'motor'
export type PinCap = 'in' | 'out' | 'pwm' | 'adc'

export interface PinSlot {
  key: string
  label: string
  cap: PinCap
  optional?: boolean
}

export interface MethodDef {
  name: string
  desc: string
}

export interface DeviceTypeInfo {
  type: DeviceType
  label: string
  cls: string // Python-Klassenname (Anzeige)
  /** robopy-Factory, die das Gerät erzeugt (EeZear-Stil: DO/DI/BTN/AIN/PWM/Motor). */
  factory: string
  /** Icon fürs UI / die Token-Tastatur (nur Beschriftung, kein Code). */
  emoji: string
  /** Methode bei bloßer Referenz ohne Attribut (z. B. Taster -> pressed). */
  bareMethod?: string
  slots: PinSlot[]
  methods: MethodDef[]
  /** Fertige Code-Schnipsel zum Einfügen; {i} = Instanzname. */
  snippets: string[]
}

const AIN_METHODS: MethodDef[] = [
  { name: 'value', desc: '0..255 (skaliert, wie EeZears Ax)' },
  { name: 'raw', desc: '0..4095 (roh)' },
]
const AIN_SNIPPETS = ['{i}.v', '{i}.raw']

export const DEVICE_TYPES: Record<DeviceType, DeviceTypeInfo> = {
  button: {
    type: 'button',
    label: 'Taster',
    cls: 'BTN',
    factory: 'BTN', // Pull-Up + invertiert + entprellt (EeZear-BTN)
    emoji: '\u{1F532}', // 🔲
    bareMethod: 'pressed', // 🔲NAME ohne Attribut = gedrückt (active-low gegen GND)
    slots: [{ key: 'pin', label: 'Pin', cap: 'in' }],
    methods: [
      { name: 'pressed', desc: 'True solange gedrückt (entprellt)' },
      { name: 'was_clicked', desc: 'True einmal pro neuer Druck-Flanke' },
    ],
    snippets: ['if {i}:', '{i}.p', '{i}.v'],
  },
  led: {
    type: 'led',
    label: 'LED',
    cls: 'DO',
    factory: 'DO',
    emoji: '\u{1F4A1}', // 💡
    slots: [{ key: 'pin', label: 'Pin', cap: 'out' }],
    methods: [
      { name: 'on', desc: 'einschalten' },
      { name: 'off', desc: 'ausschalten' },
      { name: 'toggle', desc: 'umschalten' },
      { name: 'set', desc: 'set(x): 1/0' },
    ],
    snippets: ['{i}.v = 1', '{i}.v = 0', '{i}.on()', '{i}.off()', '{i}.toggle()'],
  },
  din: {
    type: 'din',
    label: 'DIN (Digitaleingang)',
    cls: 'DI',
    factory: 'DI',
    emoji: '\u{1F4E5}', // 📥
    bareMethod: 'value',
    slots: [{ key: 'pin', label: 'Pin', cap: 'in' }],
    methods: [
      { name: 'value', desc: '0 oder 1' },
      { name: 'is_high', desc: 'True bei HIGH' },
      { name: 'is_low', desc: 'True bei LOW' },
    ],
    snippets: ['if {i}:', '{i}.v'],
  },
  dout: {
    type: 'dout',
    label: 'DOUT (Digitalausgang)',
    cls: 'DO',
    factory: 'DO',
    emoji: '\u{1F4E4}', // 📤
    slots: [{ key: 'pin', label: 'Pin', cap: 'out' }],
    methods: [
      { name: 'on', desc: 'HIGH' },
      { name: 'off', desc: 'LOW' },
      { name: 'toggle', desc: 'umschalten' },
      { name: 'set', desc: 'set(x): 1/0' },
    ],
    snippets: ['{i}.v = 1', '{i}.v = 0', '{i}.on()', '{i}.off()', '{i}.toggle()'],
  },
  light: {
    type: 'light',
    label: 'Lichtsensor',
    cls: 'AIN', // intern derselbe Analogeingang
    factory: 'AIN',
    emoji: '\u{1F441}️', // 👁️
    bareMethod: 'value',
    slots: [{ key: 'pin', label: 'Pin (ADC)', cap: 'adc' }],
    methods: AIN_METHODS,
    snippets: AIN_SNIPPETS,
  },
  ain: {
    type: 'ain',
    label: 'AIN (allgemein)',
    cls: 'AIN',
    factory: 'AIN',
    emoji: '\u{1F39B}️', // 🎛️
    bareMethod: 'value',
    slots: [{ key: 'pin', label: 'Pin (ADC)', cap: 'adc' }],
    methods: AIN_METHODS,
    snippets: AIN_SNIPPETS,
  },
  poti: {
    type: 'poti',
    label: 'Potentiometer',
    cls: 'AIN',
    factory: 'AIN',
    emoji: '\u{1F39A}️', // 🎚️
    bareMethod: 'value',
    slots: [{ key: 'pin', label: 'Pin (ADC)', cap: 'adc' }],
    methods: AIN_METHODS,
    snippets: AIN_SNIPPETS,
  },
  motor: {
    type: 'motor',
    label: 'Motor (H-Brücke)',
    cls: 'Motor',
    factory: 'Motor',
    emoji: '⚙️', // ⚙️
    slots: [
      { key: 'a', label: 'PWM A', cap: 'pwm' },
      { key: 'b', label: 'PWM B', cap: 'pwm' },
      { key: 'en', label: 'En/Dis (optional)', cap: 'out', optional: true },
    ],
    methods: [
      { name: 'speed', desc: 'speed(pct): -100..100' },
      { name: 'stop', desc: 'austrudeln' },
      { name: 'brake', desc: 'Kurzschlussbremse' },
    ],
    snippets: ['{i}.v = 80', '{i}.speed(80)', '{i}.stop()', '{i}.brake()'],
  },
}

export interface Device {
  id: string
  type: DeviceType
  name: string
  pins: Record<string, number | undefined>
}

// --- Namenskonvention: Block-Name -> Python-Instanzname ---
const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for',
  'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or',
  'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
])

export function slug(name: string): string {
  let s = name
    .trim()
    .toLowerCase()
    .replace(/[äöü]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue' })[c] ?? c)
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (s === '' || /^[0-9]/.test(s)) s = 'dev_' + s
  if (PY_KEYWORDS.has(s)) s = s + '_'
  return s
}

/** Eindeutige Instanznamen über alle Geräte (bei Kollision _2, _3, …). */
export function instanceNames(devices: Device[]): Map<string, string> {
  const used = new Set<string>()
  const map = new Map<string, string>()
  for (const d of devices) {
    let base = slug(d.name)
    let name = base
    let i = 2
    while (used.has(name)) name = `${base}_${i++}`
    used.add(name)
    map.set(d.id, name)
  }
  return map
}

// --- Capability-Prüfung ---
export function pinAllowed(cap: PinCap, p: PinDef): boolean {
  switch (cap) {
    case 'in':
      return !p.reserved
    case 'out':
      return canOutput(p)
    case 'pwm':
      return canPwm(p)
    case 'adc':
      return canAdc(p)
  }
}

export interface Issue {
  deviceId: string
  level: 'error' | 'warn'
  message: string
}

export function validate(board: Board, devices: Device[]): Issue[] {
  const issues: Issue[] = []
  const usedPins = new Map<number, string>() // gpio -> deviceName

  for (const d of devices) {
    const info = DEVICE_TYPES[d.type]
    for (const slot of info.slots) {
      const gpio = d.pins[slot.key]
      if (gpio === undefined) {
        if (!slot.optional) {
          issues.push({ deviceId: d.id, level: 'error', message: `${d.name}: Pin „${slot.label}" fehlt.` })
        }
        continue
      }
      const p = pinDef(board, gpio)
      if (!p) {
        issues.push({ deviceId: d.id, level: 'error', message: `${d.name}: GPIO ${gpio} gibt es auf diesem Board nicht.` })
        continue
      }
      if (!pinAllowed(slot.cap, p)) {
        const why = p.reserved ? 'reserviert' : p.inputOnly ? 'nur Eingang' : slot.cap === 'adc' ? 'nicht ADC-fähig' : 'ungeeignet'
        issues.push({ deviceId: d.id, level: 'error', message: `${d.name}: GPIO ${gpio} ist für „${slot.label}" ${why}.` })
      }
      if (p.strapping) {
        issues.push({ deviceId: d.id, level: 'warn', message: `${d.name}: GPIO ${gpio} ist ein Strapping-/Boot-Pin${p.note ? ` (${p.note})` : ''} — kann den Start stören.` })
      }
      const prev = usedPins.get(gpio)
      if (prev) {
        issues.push({ deviceId: d.id, level: 'error', message: `GPIO ${gpio} ist doppelt belegt (${prev} und ${d.name}).` })
      } else {
        usedPins.set(gpio, d.name)
      }
    }
  }
  return issues
}

/** EeZear-Setup-Zeile eines Geräts, z. B. `led1 = DO(13)` oder `taster1 = BTN(2)`.
 *  Single-Pin-Typen nutzen ihre Factory direkt; light/ain/poti teilen AIN. */
export function emitInstance(d: Device, instance: string): string {
  const info = DEVICE_TYPES[d.type]
  if (d.type === 'motor') {
    const parts = [String(d.pins.a), String(d.pins.b)]
    if (d.pins.en !== undefined) parts.push(`en=${d.pins.en}`)
    return `${instance} = Motor(${parts.join(', ')})`
  }
  // Alle übrigen Typen haben genau einen Pin-Slot "pin".
  return `${instance} = ${info.factory}(${d.pins.pin})`
}
