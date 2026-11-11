// Datenmodell des Projekts.
//
// Terminologie-Hinweis (bewusste Entscheidung): Nach außen heißen die
// Code-Container weiterhin "Block" (Projektvokabular aus der Spezifikation).
// Beim Generieren (siehe hw/assemble.ts) werden sie zu echten
// Python-Funktionen — ein "Block" ist also ein Quelltext-Container, KEIN
// Scratch-artiger visueller Block.

import { BOARDS, PinDesc } from '../hw/boards'

export type BlockKind = 'setup' | 'main' | 'function' | 'lib'

export interface Block {
  id: string
  /** Eindeutiger Name, wird zum Python-Funktionsnamen (außer setup/main). */
  name: string
  /** RobotCode-Quelltext (Emoji-Syntax + normales Python gemischt). */
  code: string
  kind: BlockKind
  /** Deaktivierte Blöcke werden nicht transpiliert/ausgeführt. */
  enabled: boolean
}

export interface Project {
  /** Stabile ID für die Mehrprojekt-Ablage (0.1). */
  id: string
  name: string
  /** Zielhardware-Kennung, nur informativ im Header. */
  target: string
  /** Gewähltes Board (0.2) — pro Projekt. */
  boardId: string
  /** Eigene Pin-Belegung (Board fürs Projekt geklont); leer = Board-Standard. */
  pins?: PinDesc[]
  blocks: Block[]
}

let idCounter = 0
export function newId(prefix = 'blk'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`
}

const DEFAULT_BOARD = BOARDS[0].id

/** Das in der Spezifikation geforderte Beispielprojekt "Line Follower". */
export function createLineFollowerProject(): Project {
  return {
    id: newId('prj'),
    name: 'Line Follower',
    target: 'ESP32 · MicroPython',
    boardId: DEFAULT_BOARD,
    blocks: [
      {
        id: newId(),
        name: 'SETUP',
        kind: 'setup',
        enabled: true,
        code: [
          '# Motoren und Sensoren konfigurieren (laeuft einmal)',
          '⚙️L = MOTOR(1, 2)',
          '⚙️R = MOTOR(3, 4)',
          '👁️ LEFT = SENSOR(34)',
          '👁️ RIGHT = SENSOR(35)',
        ].join('\n'),
      },
      {
        id: newId(),
        name: 'MAIN',
        kind: 'main',
        enabled: true,
        code: [
          '🔁:',
          '  ❓ LEFT = BLACK:',
          '    🤖⬅️ = 50',
          '  ELSE:',
          '    ❓ RIGHT = BLACK:',
          '      🤖➡️ = 50',
          '    ELSE:',
          '      🤖⬆️ = 70',
        ].join('\n'),
      },
    ],
  }
}

/** Playground mit genau drei festen Tabs: SETUP · MAIN · LIB.
 *  SETUP = Geräte an Pins, LIB = eigene defs, MAIN = Programm. Alles echtes
 *  MicroPython (EeZear-DSL darunter); kein Transpiler. */
export function createPlaygroundProject(name = 'Mein Programm', boardId = DEFAULT_BOARD): Project {
  return {
    id: newId('prj'),
    name,
    target: 'ESP32 · MicroPython',
    boardId,
    blocks: [
      {
        id: newId(),
        name: 'SETUP',
        kind: 'setup',
        enabled: true,
        code: [
          '# Das Board b ist schon da: b.do0..5, b.di0..1, b.a0..4',
          '# (hier nur noetig, wenn du eigene Geraete benennen willst)',
        ].join('\n'),
      },
      {
        id: newId(),
        name: 'MAIN',
        kind: 'main',
        enabled: true,
        code: [
          '# Blinken + seriell senden (erscheint im Terminal der App)',
          'n = 0',
          'while True:',
          '    b.do3 = 1',
          '    log("blink", n)',
          '    wait(500)',
          '    b.do3 = 0',
          '    wait(500)',
          '    n = n + 1',
        ].join('\n'),
      },
      {
        id: newId(),
        name: 'LIB',
        kind: 'lib',
        enabled: true,
        code: [
          '# Eigene Funktionen (hier nichts nötig)',
        ].join('\n'),
      },
    ],
  }
}

export function createEmptyProject(name = 'Neues Projekt'): Project {
  return {
    id: newId('prj'),
    name,
    target: 'ESP32 · MicroPython',
    boardId: DEFAULT_BOARD,
    blocks: [
      { id: newId(), name: 'SETUP', kind: 'setup', enabled: true, code: '# Initialisierung (laeuft einmal)\n' },
      { id: newId(), name: 'MAIN', kind: 'main', enabled: true, code: '# Hauptprogramm\n' },
    ],
  }
}

// --- Persistenz: bewusst lokal (localStorage), kein Backend (Spec §1). ---
//
// Mehrprojekt-Ablage (0.1): ein Index mit Kurznamen + je Projekt ein Eintrag,
// dazu die ID des aktuellen Projekts. Kein Pfad/Verzeichnis nötig — der Ort
// ist fest (localStorage). Projekte überleben Neuladen/Neustart der App.

const INDEX_KEY = 'robocode.projects.index.v1'
const CURRENT_KEY = 'robocode.currentProject.v1'
const projKey = (id: string) => `robocode.project.v1.${id}`
const LEGACY_KEY = 'robocode.project.v1' // alte Einzel-Ablage

export interface ProjectInfo {
  id: string
  name: string
  updatedAt: number
}

function readIndex(): ProjectInfo[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as ProjectInfo[]) : []
  } catch {
    return []
  }
}

function writeIndex(list: ProjectInfo[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list))
  } catch {
    /* privater Modus / blockiert — Speichern ist Komfort */
  }
}

/** Einmalige Übernahme der alten Einzel-Ablage in die Mehrprojekt-Ablage. */
function migrateLegacy(): void {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return
    const old = JSON.parse(raw) as Partial<Project>
    if (!old || !Array.isArray(old.blocks)) return
    const p: Project = {
      id: old.id ?? newId('prj'),
      name: old.name ?? 'Mein Programm',
      target: old.target ?? 'ESP32 · MicroPython',
      boardId: old.boardId ?? DEFAULT_BOARD,
      pins: old.pins,
      blocks: old.blocks as Block[],
    }
    saveProjectRecord(p)
    setCurrentProjectId(p.id)
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* ignorieren */
  }
}

/** Liste aller gespeicherten Projekte (neueste zuerst). */
export function listProjects(): ProjectInfo[] {
  if (readIndex().length === 0) migrateLegacy()
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function loadProjectById(id: string): Project | null {
  try {
    const raw = localStorage.getItem(projKey(id))
    if (!raw) return null
    const p = JSON.parse(raw) as Project
    if (!p || !Array.isArray(p.blocks)) return null
    if (!p.boardId) p.boardId = DEFAULT_BOARD
    return p
  } catch {
    return null
  }
}

/** Projekt speichern (Datensatz + Index aktualisieren). */
export function saveProjectRecord(p: Project): void {
  try {
    localStorage.setItem(projKey(p.id), JSON.stringify(p))
    const list = readIndex().filter((e) => e.id !== p.id)
    list.push({ id: p.id, name: p.name, updatedAt: Date.now() })
    writeIndex(list)
  } catch {
    /* privater Modus / blockiert */
  }
}

export function deleteProjectRecord(id: string): void {
  try {
    localStorage.removeItem(projKey(id))
    writeIndex(readIndex().filter((e) => e.id !== id))
  } catch {
    /* ignorieren */
  }
}

export function getCurrentProjectId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY)
  } catch {
    return null
  }
}

export function setCurrentProjectId(id: string): void {
  try {
    localStorage.setItem(CURRENT_KEY, id)
  } catch {
    /* ignorieren */
  }
}

/** Das zuletzt genutzte Projekt laden — oder implizit ein Default-Projekt
 *  anlegen und speichern (man kann ohne explizites Anlegen loslegen, 0.1). */
export function loadOrCreateCurrent(): Project {
  const infos = listProjects() // triggert ggf. Migration
  const curId = getCurrentProjectId()
  if (curId) {
    const p = loadProjectById(curId)
    if (p) return p
  }
  if (infos.length > 0) {
    const p = loadProjectById(infos[0].id)
    if (p) {
      setCurrentProjectId(p.id)
      return p
    }
  }
  const fresh = createPlaygroundProject()
  saveProjectRecord(fresh)
  setCurrentProjectId(fresh.id)
  return fresh
}

// --- Kompatible Alt-API (von App.tsx genutzt) ---

/** Aktuelles Projekt speichern. */
export function saveProject(p: Project): void {
  saveProjectRecord(p)
  setCurrentProjectId(p.id)
}

/** Aktuelles (zuletzt genutztes) Projekt laden. */
export function loadProject(): Project | null {
  const curId = getCurrentProjectId()
  if (curId) return loadProjectById(curId)
  const infos = listProjects()
  return infos.length ? loadProjectById(infos[0].id) : null
}

export function exportProjectJson(p: Project): string {
  return JSON.stringify(p, null, 2)
}
