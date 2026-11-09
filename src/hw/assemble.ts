// Zusammenbau der EINEN main.py: eingebettete robopy-Lib (EeZear-Stil) +
// Geräte-Setup + der Sketch — OHNE Transpiler. Was im Editor steht, ist schon
// das Python, das der ESP32 ausführt (kein Zwischenformat, keine Übersetzung).
// Genau diese Datei würde die Android-App per raw-REPL auf den ESP32 schreiben.

import robopySource from '../../firmware/robopy.py?raw'
import { Board } from './boards'
import { Device, instanceNames, emitInstance } from './devices'

export interface Assembled {
  mainPy: string
  /** Geräte-Name -> Python-Instanz (für Anzeige). */
  instances: Map<string, string>
}

export function assembleMainPy(board: Board, devices: Device[], sketch: string): Assembled {
  const instances = instanceNames(devices)

  const setupLines = devices.map((d) => emitInstance(d, instances.get(d.id)!))
  const setup = setupLines.length ? setupLines.join('\n') : '# (noch keine Geräte konfiguriert)'

  const header = [
    '# ======================================================================',
    '# main.py — EeZear-Stil, zusammengebaut von robocode (KEIN Transpiler)',
    `# Board: ${board.name} (${board.chip}, Flash-Offset 0x${board.flashOffset.toString(16)})`,
    '# Diese Datei wird komplett auf den ESP32 übertragen und als main.py gestartet.',
    '# ======================================================================',
  ].join('\n')

  const mainPy = [
    header,
    '',
    '# ----- robopy-Bibliothek (eingebettet, EeZear-Stil) -----',
    robopySource.trim(),
    '',
    '# ----- Hardware-Konfiguration (benannte Geräte) -----',
    setup,
    '',
    '# ----- Sketch -----',
    sketch.trim() || '# (noch kein Sketch)',
    '',
  ].join('\n')

  return { mainPy, instances }
}
