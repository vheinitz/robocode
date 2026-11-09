// RobotCode -> MicroPython Transpiler.
//
// Bewusst zeilenorientiert (Spec §8: "A simple line-oriented transpiler is
// sufficient for the first version"). Korrekt behandelt werden: Einrueckung,
// Verschachtelung (ergibt sich automatisch, da jede Zeile unabhaengig
// uebersetzt und die Einrueckung erhalten bleibt), Strings und Kommentare
// (dort werden Emoji NICHT ersetzt).
//
// Die Zuordnung Original- -> generierte Zeile wird als "source map" gefuehrt
// (etablierter Begriff; die Spec nennt es "line mappings").

import { Block } from '../model/project'
import {
  EMOJI,
  ROBOT_FWD,
  ROBOT_BACK,
  ROBOT_LEFT,
  ROBOT_RIGHT,
  ROBOT_STOP,
} from './vocabulary'

export type SymbolKind = 'sensor' | 'distance' | 'led' | 'motor'

export interface SymbolInfo {
  kind: SymbolKind
  /** Name im Quelltext (z. B. LEFT). */
  name: string
  /** Python-Instanzvariable (z. B. left). */
  instance: string
  pins: number[]
}

export interface SymbolTable {
  byName: Map<string, SymbolInfo>
  functionNames: Set<string>
  hasMotors: boolean
}

export interface TranspileError {
  blockName: string
  line: number // 1-basiert, bezogen auf den Quellblock
  message: string
}

export interface SourceMapEntry {
  blockId: string
  blockName: string
  srcLine: number // 1-basiert im Block
  genLine: number // 1-basiert in der generierten Datei
}

export interface TranspileResult {
  code: string
  map: SourceMapEntry[]
  errors: TranspileError[]
  symbols: SymbolTable
}

// --- Deklarations-Muster (auch fuer die Symboltabelle genutzt) ---
const RE_SENSOR = new RegExp(`^${EMOJI.SENSOR}\\s*([A-Za-z_]\\w*)\\s*=\\s*SENSOR\\s*\\(\\s*(\\d+)\\s*\\)$`)
const RE_DISTANCE = new RegExp(`^${EMOJI.DISTANCE}\\s*([A-Za-z_]\\w*)\\s*=\\s*ULTRASONIC\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)$`)
const RE_LED = new RegExp(`^${EMOJI.LED}\\s*([A-Za-z_]\\w*)\\s*=\\s*LED\\s*\\(\\s*(\\d+)\\s*\\)$`)
const RE_MOTOR_L = new RegExp(`^${EMOJI.MOTOR}\\s*L\\s*=\\s*MOTOR\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)$`)
const RE_MOTOR_R = new RegExp(`^${EMOJI.MOTOR}\\s*R\\s*=\\s*MOTOR\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)$`)

function instanceName(name: string): string {
  return name.toLowerCase()
}

/** Erster Durchlauf: Deklarationen aus allen aktiven Bloecken sammeln. */
export function collectSymbols(blocks: Block[]): SymbolTable {
  const byName = new Map<string, SymbolInfo>()
  const functionNames = new Set<string>()
  let hasMotors = false

  for (const b of blocks) {
    if (!b.enabled) continue
    if (b.kind === 'function') functionNames.add(b.name)

    for (const raw of b.code.split('\n')) {
      const body = stripComment(raw).trim()
      let m: RegExpMatchArray | null
      if ((m = body.match(RE_SENSOR))) {
        byName.set(m[1], { kind: 'sensor', name: m[1], instance: instanceName(m[1]), pins: [Number(m[2])] })
      } else if ((m = body.match(RE_DISTANCE))) {
        byName.set(m[1], { kind: 'distance', name: m[1], instance: instanceName(m[1]), pins: [Number(m[2]), Number(m[3])] })
      } else if ((m = body.match(RE_LED))) {
        byName.set(m[1], { kind: 'led', name: m[1], instance: instanceName(m[1]), pins: [Number(m[2])] })
      } else if (RE_MOTOR_L.test(body) || RE_MOTOR_R.test(body)) {
        hasMotors = true
      }
    }
  }
  return { byName, functionNames, hasMotors }
}

/** Kommentar abtrennen (erstes '#', das nicht in einem String steht). */
function stripComment(line: string): string {
  let inStr: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inStr) {
      if (c === inStr && line[i - 1] !== '\\') inStr = null
    } else if (c === '"' || c === "'") {
      inStr = c
    } else if (c === '#') {
      return line.slice(0, i)
    }
  }
  return line
}

function commentOf(line: string): string {
  const code = stripComment(line)
  return line.slice(code.length)
}

// String-Literale maskieren, damit darin keine Token ersetzt werden.
function protectStrings(code: string): { masked: string; restore: (s: string) => string } {
  const store: string[] = []
  const masked = code.replace(/(["'])(?:\\.|(?!\1).)*\1/g, (match) => {
    const token = `\u0000S${store.length}\u0000`
    store.push(match)
    return token
  })
  return {
    masked,
    restore: (s: string) => s.replace(/\u0000S(\d+)\u0000/g, (_, i) => store[Number(i)]),
  }
}

/** Ausdruck in einer Bedingung uebersetzen (Sensoren, Vergleich, Konstanten). */
function transformCondition(expr: string, sym: SymbolTable): string {
  let out = expr

  // '=' (einzeln) -> '==', aber ==, <=, >=, != unangetastet lassen.
  out = out.replace(/(?<![<>=!])=(?!=)/g, '==')

  // Linien-Sensor gegen BLACK/WHITE -> semantische Helfer (gut simulierbar).
  for (const s of sym.byName.values()) {
    if (s.kind !== 'sensor') continue
    const name = escapeRe(s.name)
    out = out.replace(new RegExp(`\\b${name}\\s*==\\s*BLACK\\b`, 'g'), `${s.instance}.is_black()`)
    out = out.replace(new RegExp(`\\b${name}\\s*==\\s*WHITE\\b`, 'g'), `${s.instance}.is_white()`)
  }

  // Verbliebene Sensor-/Distanz-Namen als Wert -> .read() / .distance().
  for (const s of sym.byName.values()) {
    if (s.kind === 'sensor') {
      out = out.replace(barewordRe(s.name), `${s.instance}.read()`)
    } else if (s.kind === 'distance') {
      out = out.replace(barewordRe(s.name), `${s.instance}.distance()`)
    }
  }

  // Restliche Konstanten auf Zahlenwerte abbilden.
  out = out
    .replace(/\bBLACK\b/g, '0')
    .replace(/\bWHITE\b/g, '4095')
    .replace(/\bON\b/g, '1')
    .replace(/\bOFF\b/g, '0')

  return out
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
// Bareword, nicht von '.', Wortzeichen oder '(' umgeben (also echte Verwendung).
function barewordRe(name: string): RegExp {
  return new RegExp(`(?<![.\\w])${escapeRe(name)}(?![\\w])(?!\\s*\\()`, 'g')
}

/** Eine Code-Zeile (ohne Einrueckung/Kommentar) uebersetzen. */
function transformBody(body: string, sym: SymbolTable): string {
  const t = body.trim()
  if (t === '') return body

  let m: RegExpMatchArray | null

  // 1) Deklarationen
  if ((m = t.match(RE_SENSOR))) return `${instanceName(m[1])} = Sensor(${m[2]})`
  if ((m = t.match(RE_DISTANCE))) return `${instanceName(m[1])} = Ultrasonic(${m[2]}, ${m[3]})`
  if ((m = t.match(RE_LED))) return `${instanceName(m[1])} = Led(${m[2]})`
  if ((m = t.match(RE_MOTOR_L))) return `motor_l = Motor(${m[1]}, ${m[2]})`
  if ((m = t.match(RE_MOTOR_R))) return `motor_r = Motor(${m[1]}, ${m[2]})`

  // 2) Roboter-Bewegung
  if ((m = t.match(new RegExp(`^${ROBOT_FWD}\\s*=\\s*(-?\\d+)$`)))) return `robot.forward(${m[1]})`
  if ((m = t.match(new RegExp(`^${ROBOT_BACK}\\s*=\\s*(-?\\d+)$`)))) return `robot.backward(${m[1]})`
  if ((m = t.match(new RegExp(`^${ROBOT_LEFT}\\s*=\\s*(-?\\d+)$`)))) return `robot.left(${m[1]})`
  if ((m = t.match(new RegExp(`^${ROBOT_RIGHT}\\s*=\\s*(-?\\d+)$`)))) return `robot.right(${m[1]})`
  if (new RegExp(`^${ROBOT_STOP}$`).test(t)) return 'robot.stop()'

  // 3) Einzelne Motoren
  if ((m = t.match(new RegExp(`^${EMOJI.MOTOR}\\s*L\\s*=\\s*(-?\\d+)$`)))) return `motor_l.speed(${m[1]})`
  if ((m = t.match(new RegExp(`^${EMOJI.MOTOR}\\s*R\\s*=\\s*(-?\\d+)$`)))) return `motor_r.speed(${m[1]})`

  // 4) LED
  if ((m = t.match(new RegExp(`^${EMOJI.LED}\\s*([A-Za-z_]\\w*)\\s*=\\s*(ON|OFF|\\d+)$`)))) {
    const v = m[2] === 'ON' ? '1' : m[2] === 'OFF' ? '0' : m[2]
    return `${instanceName(m[1])}.value(${v})`
  }

  // 5) Warten
  if ((m = t.match(new RegExp(`^${EMOJI.WAIT}\\s*(\\d+)$`)))) return `time.sleep_ms(${m[1]})`

  // 6) Kontrollstrukturen
  if ((m = t.match(new RegExp(`^${EMOJI.IF}\\s*(.*?):?$`)))) return `if ${transformCondition(m[1].trim(), sym)}:`
  if (/^ELSE\s*:?$/.test(t)) return 'else:'
  if ((m = t.match(new RegExp(`^${EMOJI.FOR}\\s*(\\d+)\\s*:?$`)))) return `for _ in range(${m[1]}):`
  if (new RegExp(`^${EMOJI.WHILE}\\s*:?$`).test(t)) return 'while True:'
  if ((m = t.match(new RegExp(`^${EMOJI.FUNC}\\s*([A-Za-z_]\\w*)\\s*:?$`)))) return `def ${instanceName(m[1])}():`

  // 7) Funktionsaufruf (Zeile ist nur ein bekannter Blockname)
  if ((m = t.match(/^([A-Za-z_]\w*)$/)) && sym.functionNames.has(m[1])) {
    return `${instanceName(m[1])}()`
  }

  // 8) Sonst: normales Python unveraendert lassen (Spec-Grundsatz).
  return body
}

function transpileCodeLine(line: string, sym: SymbolTable): string {
  const indentMatch = line.match(/^(\s*)/)
  const indent = indentMatch ? indentMatch[1] : ''
  const rest = line.slice(indent.length)

  const codePart = stripComment(rest)
  const comment = commentOf(rest)

  const { masked, restore } = protectStrings(codePart)
  const transformed = transformBody(masked, sym)
  return indent + restore(transformed) + comment
}

/** Einen Block uebersetzen (ohne def-Huelle; die setzt der Codegen). */
export function transpileBlock(block: Block, sym: SymbolTable, genStart: number): {
  lines: string[]
  map: SourceMapEntry[]
  errors: TranspileError[]
} {
  const srcLines = block.code.split('\n')
  const lines: string[] = []
  const map: SourceMapEntry[] = []
  const errors: TranspileError[] = []

  srcLines.forEach((src, i) => {
    let gen: string
    try {
      gen = transpileCodeLine(src, sym)
    } catch (e) {
      gen = src
      errors.push({ blockName: block.name, line: i + 1, message: String(e) })
    }
    lines.push(gen)
    map.push({ blockId: block.id, blockName: block.name, srcLine: i + 1, genLine: genStart + lines.length - 1 })
  })

  return { lines, map, errors }
}
