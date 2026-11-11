// Zusammenbau der EINEN main.py aus den drei Playground-Tabs.
//
// Reihenfolge: versteckte DSL (robopy, EeZear-Stil, NICHT editierbar) -> SETUP
// (Geräte an Pins) -> LIB (selbst definierte defs) -> MAIN (Programm). Kein
// Transpiler: SETUP/LIB/MAIN sind schon echtes MicroPython, das die Emoji-Tasten
// als Text einfügen. Genau diese Datei überträgt die Android-App per raw-REPL.

import robopySource from '../../firmware/robopy.py?raw'
import { Board, PinDesc, predefinedPinLines, customPinLines } from './boards'

export interface Parts {
  setup: string
  lib: string
  main: string
}

export interface Assembled {
  mainPy: string
}

function section(title: string, body: string, fallback: string): string {
  const b = body.trim()
  return `# ----- ${title} -----\n${b || fallback}`
}

export function assembleSketch(parts: Parts, board: Board, pins?: PinDesc[]): Assembled {
  const header = [
    '# ======================================================================',
    '# main.py — zusammengebaut vom robolang-Playground (EeZear-Stil, KEIN Transpiler)',
    `# Board: ${board.name} (${board.chip}, Flash-Offset 0x${board.flashOffset.toString(16)})`,
    '# Aufbau: DSL (versteckt) + vordefinierte Pins + SETUP + LIB + MAIN.',
    '# Wird komplett auf den ESP32 übertragen und als main.py gestartet.',
    '# ======================================================================',
  ].join('\n')

  const mainPy = [
    header,
    '',
    '# ----- DSL-Bibliothek (versteckt, nicht editierbar; EeZear-Stil) -----',
    robopySource.trim(),
    '',
    `# ----- Vordefinierte Pins für ${board.name} (versteckt) -----`,
    predefinedPinLines(board),
    ...(pins && pins.length ? ['', customPinLines(pins)] : []),
    '',
    section('SETUP (Geräte an Pins)', parts.setup, '# (noch keine Geräte)'),
    '',
    section('LIB (eigene Funktionen)', parts.lib, '# (keine eigenen Funktionen)'),
    '',
    section('MAIN (Programm)', parts.main, '# (noch kein Programm)'),
    '',
  ].join('\n')

  return { mainPy }
}
