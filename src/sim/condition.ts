// Bedingungen fuer die Simulation nach JavaScript uebersetzen.
// Parallel zur Transpiler-Bedingungslogik (lang/transpiler.ts), aber Ziel ist
// hier ein JS-Ausdruck, der gegen Sensor-Objekte im Scope ausgewertet wird.
//
// Bekannte Doppelung mit dem Transpiler: akzeptabel fuer den Prototyp; bei
// Bedarf spaeter auf eine gemeinsame AST-Repraesentation zusammenfuehren.

export { collectSymbols } from '../lang/transpiler'
export type { SymbolTable } from '../lang/transpiler'

import { SymbolTable } from '../lang/transpiler'

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function barewordRe(name: string): RegExp {
  return new RegExp(`(?<![.\\w])${escapeRe(name)}(?![\\w])(?!\\s*\\()`, 'g')
}

export function transformConditionForSim(expr: string, sym: SymbolTable): string {
  let out = expr

  // '=' (einzeln) -> '=='
  out = out.replace(/(?<![<>=!])=(?!=)/g, '==')

  // Boolesche Schluesselwoerter -> JS
  out = out
    .replace(/\bAND\b/g, '&&')
    .replace(/\bOR\b/g, '||')
    .replace(/\bNOT\b/g, '!')
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||')
    .replace(/\bnot\b/g, '!')

  // Sensor gegen BLACK/WHITE -> semantische Methoden
  for (const s of sym.byName.values()) {
    if (s.kind !== 'sensor') continue
    const name = escapeRe(s.name)
    out = out.replace(new RegExp(`\\b${name}\\s*==\\s*BLACK\\b`, 'g'), `${s.instance}.is_black()`)
    out = out.replace(new RegExp(`\\b${name}\\s*==\\s*WHITE\\b`, 'g'), `${s.instance}.is_white()`)
  }

  // verbliebene Sensor-/Distanz-Namen -> .read()/.distance()
  for (const s of sym.byName.values()) {
    if (s.kind === 'sensor') out = out.replace(barewordRe(s.name), `${s.instance}.read()`)
    else if (s.kind === 'distance') out = out.replace(barewordRe(s.name), `${s.instance}.distance()`)
  }

  // Konstanten
  out = out
    .replace(/\bBLACK\b/g, '0')
    .replace(/\bWHITE\b/g, '4095')
    .replace(/\bON\b/g, '1')
    .replace(/\bOFF\b/g, '0')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null')

  return out
}
