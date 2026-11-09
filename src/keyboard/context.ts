// Kontextsensitive Vorschläge für die Emoji-Befehlstastatur.
// WICHTIG: Die Tasten fügen ECHTES (Micro)Python ein — kein Transpiler. Die
// Auswahl richtet sich nach dem Tab (SETUP/MAIN/LIB), der Cursor-Position und
// den in SETUP definierten Gerätenamen.

import { EditorContext } from '../editor/BlockEditor'
import { BlockKind } from '../model/project'

export interface Suggestion {
  label: string
  insert: string
  kind: 'cmd' | 'dir' | 'op' | 'val' | 'ctrl'
}

// SETUP: Geräte an Pins (EeZear-leicht).
// Basis-Primitive DI/DO/AI/AO + darüber die Synonyme/Wrapper LED/Taster/Motor.
const SETUP_DEFS: Suggestion[] = [
  // Basis (digital/analog, ein/aus)
  { label: '📥 DI ein', insert: 'eingang = DI(4)', kind: 'cmd' },
  { label: '📤 DO aus', insert: 'ausgang = DO(5)', kind: 'cmd' },
  { label: '🎚️ AI analog', insert: 'poti = AI(0)', kind: 'cmd' },
  { label: '🔆 AO PWM', insert: 'dimmer = AO(5)', kind: 'cmd' },
  // Wrapper/Synonyme (vertraute Begriffe über DI/DO)
  { label: '💡 LED', insert: 'led = LED(13)', kind: 'cmd' },
  { label: '🔘 Taster', insert: 'taster = TASTER(2)', kind: 'cmd' },
  { label: '⚙️ Motor', insert: 'motor = MOTOR(6, 7)', kind: 'cmd' },
]

// Steuerfluss (MAIN/LIB).
const CONTROL: Suggestion[] = [
  { label: '🔁 Schleife', insert: 'while True:', kind: 'ctrl' },
  { label: '❓ wenn', insert: 'if ', kind: 'ctrl' },
  { label: '❓! sonst-wenn', insert: 'elif ', kind: 'ctrl' },
  { label: 'sonst', insert: 'else:', kind: 'ctrl' },
  { label: '🔄 wiederhole', insert: 'for i in range(10):', kind: 'ctrl' },
  { label: '⏱️ warten', insert: 'sleep_ms(100)', kind: 'cmd' },
  { label: '⏱ Takt', insert: 'takt = Every(300)', kind: 'cmd' },
]

const DEF: Suggestion = { label: '🧩 Funktion', insert: 'def name():', kind: 'cmd' }

// Aktionen, sobald der Cursor hinter einem bekannten Gerätenamen steht.
const ACTIONS: Suggestion[] = [
  { label: '= 1 (an)', insert: '.v = 1', kind: 'dir' },
  { label: '= 0 (aus)', insert: '.v = 0', kind: 'dir' },
  { label: '= 128 (AO)', insert: '.v = 128', kind: 'dir' },
  { label: 'umschalten', insert: '.toggle()', kind: 'dir' },
  { label: '.on()', insert: '.on()', kind: 'dir' },
  { label: '.off()', insert: '.off()', kind: 'dir' },
  { label: 'Wert .v', insert: '.v', kind: 'val' },
  { label: 'Tempo', insert: '.speed(80)', kind: 'dir' },
]

const OPS: Suggestion[] = [
  { label: '>', insert: ' > ', kind: 'op' },
  { label: '<', insert: ' < ', kind: 'op' },
  { label: '==', insert: ' == ', kind: 'op' },
  { label: 'and', insert: ' and ', kind: 'op' },
  { label: 'or', insert: ' or ', kind: 'op' },
  { label: 'not', insert: 'not ', kind: 'op' },
]

function nameChips(names: string[]): Suggestion[] {
  return names.map((n) => ({ label: n, insert: n, kind: 'val' as const }))
}
function nameVals(names: string[]): Suggestion[] {
  return names.map((n) => ({ label: `${n}.v`, insert: `${n}.v`, kind: 'val' as const }))
}

export function getSuggestions(ctx: EditorContext, kind: BlockKind, knownNames: string[]): Suggestion[] {
  const before = ctx.lineBefore
  const trimmedEnd = before.replace(/\s+$/, '')

  // Cursor direkt hinter einem bekannten Gerätenamen -> Aktionen (.v = 1, ...).
  const nameMatch = trimmedEnd.match(/([A-Za-z_]\w*)$/)
  if (nameMatch && knownNames.includes(nameMatch[1])) return ACTIONS

  // Nach einem Vergleich/Zuweisungszeichen -> Gerätewerte anbieten.
  if (/[=<>]$/.test(trimmedEnd) && knownNames.length) return nameVals(knownNames)

  // SETUP: Geräte definieren.
  if (kind === 'setup') return SETUP_DEFS

  // MAIN/LIB am Zeilenanfang: Steuerfluss + Gerätenamen (+ def nur in LIB).
  const base = kind === 'lib' ? [DEF, ...CONTROL] : CONTROL
  return [...base, ...nameChips(knownNames), ...OPS]
}
