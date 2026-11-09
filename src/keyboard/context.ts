// Kontextsensitive Vorschlaege fuer die In-App-Befehlstastatur (Spec §6).
// Aus der Cursor-Position wird die aktuelle Bearbeitungsphase abgeleitet und
// eine passende, kompakte Vorschlagsliste erzeugt ("evolve step by step").

import { EditorContext } from '../editor/BlockEditor'
import { SymbolTable } from '../lang/transpiler'
import { EMOJI } from '../lang/vocabulary'

export interface Suggestion {
  /** Anzeigetext auf der Taste. */
  label: string
  /** Einzufuegender Text an Cursor-Position. */
  insert: string
  kind: 'cmd' | 'dir' | 'op' | 'val' | 'ctrl'
}

const TOP: Suggestion[] = [
  { label: '❓ Wenn', insert: '❓ ', kind: 'ctrl' },
  { label: 'ELSE Sonst', insert: 'ELSE:', kind: 'ctrl' },
  { label: '🔄 Wiederhole', insert: '🔄 10:', kind: 'ctrl' },
  { label: '🔁 Schleife', insert: '🔁:', kind: 'ctrl' },
  { label: '🤖 Fahren', insert: EMOJI.ROBOT, kind: 'cmd' },
  { label: '⚙️ Motor', insert: EMOJI.MOTOR, kind: 'cmd' },
  { label: '👁️ Sensor', insert: '👁️ S = SENSOR(34)', kind: 'cmd' },
  { label: '💡 LED', insert: '💡 LED = ON', kind: 'cmd' },
  { label: '⏱️ Warten', insert: '⏱️ 500', kind: 'cmd' },
  { label: '🧩 Funktion', insert: '🧩 NAME:', kind: 'cmd' },
]

const DIRECTIONS: Suggestion[] = [
  { label: '⬆️ vor', insert: '⬆️ = 70', kind: 'dir' },
  { label: '⬇️ zurück', insert: '⬇️ = 70', kind: 'dir' },
  { label: '⬅️ links', insert: '⬅️ = 50', kind: 'dir' },
  { label: '➡️ rechts', insert: '➡️ = 50', kind: 'dir' },
  { label: '⏹️ stopp', insert: '⏹️', kind: 'dir' },
]

const MOTORS: Suggestion[] = [
  { label: 'L = 70', insert: 'L = 70', kind: 'dir' },
  { label: 'R = 70', insert: 'R = 70', kind: 'dir' },
  { label: 'L definieren', insert: 'L = MOTOR(1, 2)', kind: 'dir' },
  { label: 'R definieren', insert: 'R = MOTOR(3, 4)', kind: 'dir' },
]

const COND_OPS: Suggestion[] = [
  { label: '= BLACK', insert: '= BLACK:', kind: 'op' },
  { label: '= WHITE', insert: '= WHITE:', kind: 'op' },
  { label: '>', insert: '> ', kind: 'op' },
  { label: '<', insert: '< ', kind: 'op' },
  { label: '==', insert: '== ', kind: 'op' },
  { label: '!=', insert: '!= ', kind: 'op' },
]

function sensorList(sym: SymbolTable): Suggestion[] {
  const out: Suggestion[] = []
  for (const s of sym.byName.values()) {
    if (s.kind === 'sensor' || s.kind === 'distance') {
      out.push({ label: `👁️ ${s.name}`, insert: `${s.name} `, kind: 'val' })
    }
  }
  return out
}

const KNOWN_SENSORLESS_VALUES: Suggestion[] = [
  { label: 'BLACK', insert: 'BLACK:', kind: 'val' },
  { label: 'WHITE', insert: 'WHITE:', kind: 'val' },
  { label: 'NOT', insert: 'NOT ', kind: 'op' },
  { label: 'AND', insert: 'AND ', kind: 'op' },
  { label: 'OR', insert: 'OR ', kind: 'op' },
]

export function getSuggestions(ctx: EditorContext, sym: SymbolTable): Suggestion[] {
  const before = ctx.lineBefore
  const trimmed = before.replace(/\s+$/, '')

  // Richtung nach 🤖
  if (trimmed.endsWith(EMOJI.ROBOT)) return DIRECTIONS
  // Motor nach ⚙️
  if (trimmed.endsWith(EMOJI.MOTOR)) return MOTORS

  // Bedingung nach ❓
  const ifIdx = before.lastIndexOf(EMOJI.IF)
  if (ifIdx >= 0) {
    const cond = before.slice(ifIdx + EMOJI.IF.length)
    const condTrim = cond.replace(/\s+$/, '')
    if (condTrim === '') {
      // Was pruefen? Sensoren anbieten (+ NOT).
      const list = sensorList(sym)
      return list.length
        ? [...list, { label: 'NOT', insert: 'NOT ', kind: 'op' }]
        : [
            { label: 'Pin lesen', insert: 'Pin(34).read() ', kind: 'val' },
            { label: 'NOT', insert: 'NOT ', kind: 'op' },
          ]
    }
    // endet mit Operatorzeichen -> Werte
    if (/[=!<>]$/.test(condTrim)) {
      return [...KNOWN_SENSORLESS_VALUES.filter((s) => s.kind === 'val'), ...sensorList(sym)]
    }
    // endet mit Sensorname oder Wort -> Vergleichsoperatoren
    if (/\b\w+$/.test(condTrim)) {
      return COND_OPS
    }
    return KNOWN_SENSORLESS_VALUES
  }

  // Standard: Zeilenanfang -> Top-Level-Befehle
  return TOP
}
