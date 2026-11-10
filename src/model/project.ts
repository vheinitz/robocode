// Datenmodell des Projekts.
//
// Terminologie-Hinweis (bewusste Entscheidung): Nach außen heißen die
// Code-Container weiterhin "Block" (Projektvokabular aus der Spezifikation).
// Beim Generieren (siehe lang/codegen.ts) werden sie zu echten
// Python-Funktionen — ein "Block" ist also ein Quelltext-Container, KEIN
// Scratch-artiger visueller Block.

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
  name: string
  /** Zielhardware-Kennung, nur informativ im Header. */
  target: string
  blocks: Block[]
}

let idCounter = 0
export function newId(prefix = 'blk'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`
}

/** Das in der Spezifikation geforderte Beispielprojekt "Line Follower". */
export function createLineFollowerProject(): Project {
  return {
    name: 'Line Follower',
    target: 'ESP32 · MicroPython',
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
export function createPlaygroundProject(): Project {
  return {
    name: 'Mein Programm',
    target: 'ESP32 · MicroPython',
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
          '# Blinken mit der Onboard-LED (b.do3 = GPIO8)',
          'while True:',
          '    b.do3 = 1',
          '    wait(500)',
          '    b.do3 = 0',
          '    wait(500)',
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
    name,
    target: 'ESP32 · MicroPython',
    blocks: [
      { id: newId(), name: 'SETUP', kind: 'setup', enabled: true, code: '# Initialisierung (laeuft einmal)\n' },
      { id: newId(), name: 'MAIN', kind: 'main', enabled: true, code: '# Hauptprogramm\n' },
    ],
  }
}

// --- Persistenz: bewusst lokal (localStorage), kein Backend (Spec §1). ---

const STORAGE_KEY = 'robocode.project.v1'

export function saveProject(p: Project): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    // Privater Modus / blockiert: Speichern ist nur eine Komfortfunktion.
  }
}

export function loadProject(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Project
    if (!p || !Array.isArray(p.blocks)) return null
    return p
  } catch {
    return null
  }
}

export function exportProjectJson(p: Project): string {
  return JSON.stringify(p, null, 2)
}
