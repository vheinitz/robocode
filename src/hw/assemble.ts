// Zusammenbau der EINEN main.py: eingebettete HAL-Lib + Geräte-Setup + Logik.
// Genau diese Datei würde die Android-App per raw-REPL auf den ESP32 schreiben
// (kein .bin, kein Modul-Management — ein ausführbares Skript).

import halSource from '../../firmware/hal.py?raw'
import { Board } from './boards'
import { Device, instanceNames, emitInstance } from './devices'

export interface Assembled {
  mainPy: string
  /** Geräte-Name -> Python-Instanz (für Anzeige / robolang-Mapping). */
  instances: Map<string, string>
}

export function assembleMainPy(board: Board, devices: Device[], logic: string): Assembled {
  const instances = instanceNames(devices)

  const setupLines = devices.map((d) => emitInstance(d, instances.get(d.id)!))
  const setup = setupLines.length ? setupLines.join('\n') : '# (noch keine Geräte konfiguriert)'

  const header = [
    '# ======================================================================',
    `# main.py — generiert von robolang`,
    `# Board: ${board.name} (${board.chip}, Flash-Offset 0x${board.flashOffset.toString(16)})`,
    '# Diese Datei wird komplett auf den ESP32 übertragen und als main.py gestartet.',
    '# ======================================================================',
  ].join('\n')

  const mainPy = [
    header,
    '',
    'import time',
    '',
    '# ----- HAL-Bibliothek (eingebettet) -----',
    halSource.trim(),
    '',
    '# ----- Hardware-Konfiguration -----',
    setup,
    '',
    '# ----- Programm (robolang) -----',
    logic.trim() || '# (noch keine Logik)',
    '',
  ].join('\n')

  return { mainPy, instances }
}

/** Vorgabe-Testlogik, die das konfigurierte Setup belebt (reines MicroPython). */
export function defaultLogic(): string {
  return [
    'from time import sleep_ms',
    '',
    'while True:',
    '    # Beispiel: ersetze dies später durch die robolang-Übersetzung',
    '    sleep_ms(50)',
  ].join('\n')
}
