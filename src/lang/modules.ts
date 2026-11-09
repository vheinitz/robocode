// Mehrmodul-robolang: das Programm besteht aus mehreren „robo-Skripten".
// Genau EIN Hauptmodul (kind 'main') enthält die Top-Level-Logik; weitere
// Module (kind 'module') sind Funktions-/Bibliotheksskripte mit 🧩-Definitionen.
//
// Vor dem Transpilieren werden alle Module zu EINEM Quelltext zusammengefügt
// (Funktionsmodule zuerst, Hauptmodul zuletzt). Grund: In MicroPython laufen
// Top-Level-Anweisungen sofort beim Import. Stünde die while-True-Schleife des
// Hauptmoduls vor den 🧩-Definitionen, würde sie endlos laufen und die defs nie
// erreicht. Daher: erst alle Definitionen, dann der Programmablauf.

import { newId } from '../model/project'

export interface RoboModule {
  id: string
  name: string
  kind: 'main' | 'module'
  code: string
}

export interface ModuleSpan {
  moduleId: string
  name: string
  /** 1-basierte Zeile der ersten Codezeile dieses Moduls im Gesamtquelltext. */
  startLine: number
  /** 1-basierte Zeile der letzten Codezeile dieses Moduls. */
  endLine: number
}

export interface CombinedSource {
  source: string
  spans: ModuleSpan[]
}

export function newModule(name: string, kind: 'main' | 'module' = 'module', code = ''): RoboModule {
  return { id: newId('mod'), name, kind, code }
}

/** Funktionsmodule zuerst, Hauptmodul zuletzt; je Modul ein Kommentarbanner.
 *  Liefert zusätzlich eine Zeilen-Zuordnung, um Transpiler-Meldungen wieder
 *  dem richtigen Modul und der lokalen Zeile zuzuschreiben. */
export function combineModules(modules: RoboModule[]): CombinedSource {
  const ordered = [
    ...modules.filter((m) => m.kind !== 'main'),
    ...modules.filter((m) => m.kind === 'main'),
  ]
  const lines: string[] = []
  const spans: ModuleSpan[] = []
  for (const m of ordered) {
    lines.push(`# === ${m.name} ===`)
    const startLine = lines.length + 1 // erste Codezeile folgt direkt auf das Banner
    for (const cl of m.code.split('\n')) lines.push(cl)
    const endLine = lines.length
    spans.push({ moduleId: m.id, name: m.name, startLine, endLine })
    lines.push('') // Leerzeile zwischen Modulen
  }
  return { source: lines.join('\n'), spans }
}

/** Globale (1-basierte) Zeile im Gesamtquelltext -> Modul + lokale Zeile. */
export function locateLine(
  spans: ModuleSpan[],
  globalLine: number,
): { moduleId: string; name: string; localLine: number } | null {
  for (const s of spans) {
    if (globalLine >= s.startLine && globalLine <= s.endLine) {
      return { moduleId: s.moduleId, name: s.name, localLine: globalLine - s.startLine + 1 }
    }
  }
  return null
}
