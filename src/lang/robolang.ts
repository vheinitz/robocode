// robolang -> MicroPython. Zeilenorientiert, Einrueckung bleibt erhalten,
// Verschachtelung ergibt sich dadurch von selbst. Referenziert HW-Geraete ueber
// <Symbol><Name>[.<Methode>]; die Symbole stammen aus DEVICE_TYPES (ein Ort der
// Wahrheit). Ohne Methode greift die Bare-Methode des Typs (Taster -> pressed,
// Sensoren/DIN -> value). Der Name wird per slug() zur Python-Instanz.

import { slug, DEVICE_TYPES } from '../hw/devices'

export interface RoboIssue {
  line: number
  level: 'error' | 'warn'
  message: string
}

export interface RoboResult {
  python: string
  issues: RoboIssue[]
}

// --- Symboltabelle aus den Geraetetypen ableiten ---
const TYPES = Object.values(DEVICE_TYPES)
// Variation-Selector (U+FE0F) im Muster optional machen und beim Nachschlagen entfernen.
const vsOptional = (e: string) => e.replace(/️/g, '️?')
const vsStrip = (e: string) => e.replace(/️/g, '')

const EMOJI_ALT = TYPES.map((t) => vsOptional(t.emoji))
  .sort((a, b) => b.length - a.length)
  .join('|')
const BARE_BY_EMOJI = new Map<string, string | undefined>(TYPES.map((t) => [vsStrip(t.emoji), t.bareMethod]))

const reEmojiRef = new RegExp(`(${EMOJI_ALT})([A-Za-z_]\\w*)(?:\\.([A-Za-z_]\\w*))?`, 'gu')

// Kontrollsymbole
const LOOP = '\u{1F501}' // 🔁
const IFQ = '❓' // ❓
const FUNC = '\u{1F9E9}' // 🧩
const WAIT = '⏱️?' // ⏱️
const MOTOR = vsOptional(DEVICE_TYPES.motor.emoji) // ⚙️

function aliasMethod(method: string): string {
  const m = method.toLowerCase()
  if (m === 'an') return 'on'
  if (m === 'aus') return 'off'
  return m
}

/** HW-Referenzen in einem Ausdruck ersetzen:
 *  👁️licht -> licht.value(), 🔲start -> start.pressed(), 💡rot.on -> rot.on(). */
function transformExpr(expr: string): string {
  return expr.replace(reEmojiRef, (_m, emoji: string, name: string, method?: string) => {
    const inst = slug(name)
    if (method) return `${inst}.${aliasMethod(method)}()`
    const bare = BARE_BY_EMOJI.get(vsStrip(emoji))
    return bare ? `${inst}.${bare}()` : inst
  })
}

/** Bedingung: HW-Refs ersetzen, Bool-Woerter und '=' (einzeln) nach Python. */
function transformCond(expr: string): string {
  let out = transformExpr(expr)
  out = out
    .replace(/\bAND\b/g, 'and')
    .replace(/\bOR\b/g, 'or')
    .replace(/\bNOT\b/g, 'not')
  out = out.replace(/(?<![<>=!])=(?!=)/g, '==')
  return out
}

function stripComment(line: string): string {
  let inStr: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inStr) {
      if (c === inStr && line[i - 1] !== '\\') inStr = null
    } else if (c === '"' || c === "'") inStr = c
    else if (c === '#') return line.slice(0, i)
  }
  return line
}

function collectFunctions(source: string): Set<string> {
  const names = new Set<string>()
  const re = new RegExp(`^\\s*${FUNC}\\s*([A-Za-z_]\\w*)`, 'u')
  for (const line of source.split('\n')) {
    const m = line.match(re)
    if (m) names.add(m[1].toLowerCase())
  }
  return names
}

function parseArgs(raw: string): string {
  const cleaned = raw.replace(/[[\]]/g, ' ').trim()
  if (cleaned === '') return ''
  return cleaned
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((a) => transformExpr(a))
    .join(', ')
}

function translate(t: string, funcs: Set<string>): string {
  let m: RegExpMatchArray | null

  // while / for
  if (new RegExp(`^${LOOP}\\s*:?$`, 'u').test(t)) return 'while True:'
  if ((m = t.match(new RegExp(`^${LOOP}([A-Za-z_]\\w*)\\s+(.+?)\\s*:?$`, 'u')))) {
    const nums = m[2].replace(/[[\],]/g, ' ').trim().split(/\s+/).filter(Boolean)
    return `for ${m[1]} in range(${nums.join(', ')}):`
  }

  // else / elif / if  (❓! = sonst, ❓!<bed> = sonst wenn; ?! als ASCII-Alias)
  if (new RegExp(`^(?:${IFQ}!|\\?!)\\s*:?$`, 'u').test(t)) return 'else:'
  if ((m = t.match(new RegExp(`^(?:${IFQ}!|\\?!)\\s+(.+?):?$`, 'u')))) return `elif ${transformCond(m[1].trim())}:`
  if ((m = t.match(new RegExp(`^${IFQ}\\s*(.*?):?$`, 'u')))) return `if ${transformCond(m[1].trim())}:`

  // Funktionsdefinition
  if ((m = t.match(new RegExp(`^${FUNC}\\s*([A-Za-z_]\\w*)\\s*(?:\\[([^\\]]*)\\])?\\s*:?$`, 'u')))) {
    const params = (m[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean).join(', ')
    return `def ${m[1].toLowerCase()}(${params}):`
  }

  // Warten
  if ((m = t.match(new RegExp(`^${WAIT}\\s*(\\d+)$`, 'u')))) return `time.sleep_ms(${m[1]})`

  // Motor-Richtung mit Geschwindigkeit: l/ccw negativ, r/cw positiv.
  if ((m = t.match(new RegExp(`^${MOTOR}([A-Za-z_]\\w*)\\.(l|r|cw|ccw)\\s*=\\s*(.+)$`, 'iu')))) {
    const inst = slug(m[1])
    const dir = m[2].toLowerCase()
    const neg = dir === 'l' || dir === 'ccw'
    const val = transformExpr(m[3].trim())
    return neg ? `${inst}.speed(-(${val}))` : `${inst}.speed(${val})`
  }

  // Funktionsaufruf: bekannter Name, optional Argumente
  if ((m = t.match(/^([A-Za-z_]\w*)(?:\s+(.*))?$/)) && funcs.has(m[1].toLowerCase())) {
    return `${m[1].toLowerCase()}(${parseArgs(m[2] ?? '')})`
  }

  // Sonst: HW-Aufrufe / Zuweisungen / normales Python
  return transformExpr(t)
}

function checkRefs(t: string, line: number, known: Set<string> | undefined, issues: RoboIssue[]) {
  if (!known) return
  const re = new RegExp(reEmojiRef.source, 'gu')
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const inst = slug(m[2])
    if (!known.has(inst)) {
      issues.push({ line, level: 'warn', message: `Unbekanntes Gerät „${m[2]}" — im Hardware-Teil nicht definiert.` })
    }
  }
}

export function transpileRobolang(source: string, knownInstances?: Set<string>): RoboResult {
  const funcs = collectFunctions(source)
  const issues: RoboIssue[] = []
  const out: string[] = []

  source.split('\n').forEach((raw, i) => {
    const indent = raw.match(/^(\s*)/)?.[1] ?? ''
    const code = stripComment(raw.slice(indent.length))
    const comment = raw.slice(indent.length).slice(code.length)
    const t = code.trim()
    if (t === '') {
      out.push(indent + comment)
      return
    }
    checkRefs(t, i + 1, knownInstances, issues)
    let gen: string
    try {
      gen = translate(t, funcs)
    } catch (e) {
      gen = t
      issues.push({ line: i + 1, level: 'error', message: String(e) })
    }
    out.push(indent + gen + comment)
  })

  return { python: out.join('\n'), issues }
}
