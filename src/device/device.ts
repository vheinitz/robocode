// Geräte-Controller für die Web-App — Browser-Gegenstück zu Androids
// MainActivity-Geräteteil. Besitzt den SerialPort und schaltet zwischen den
// Modi: Verbinden/Erkennen, Erst-Flashen (esptool-js), main.py übertragen
// (raw-REPL) und Terminal (serielle Ausgabe mitlesen).
//
// Rollenverteilung (siehe README): Web = Haupt-Programmierumgebung (verbinden,
// Programm senden, Terminal), zusätzlich Erst-Flasher wie die Android-APK.

import { Board } from '../hw/boards'
import { SerialLink, requestPort, serialSupported } from './serial'
import { MicroPythonRepl } from './repl'
import { loadFirmware } from './firmware'
// flash.ts (zieht esptool-js) wird erst beim Flashen dynamisch geladen —
// hält das Start-Bundle klein (wichtig für die PWA).

export type Phase = 'idle' | 'connecting' | 'connected' | 'nomp' | 'flashing' | 'running'

export interface DeviceState {
  supported: boolean
  phase: Phase
  status: string
  flashPct: number
  busy: boolean
  log: string[]
  terminal: string[]
}

const CAP = 500 // max. Zeilen je Protokoll (Speicher begrenzen)

export class WebDevice {
  private port: SerialPort | null = null
  private link: SerialLink | null = null
  private repl: MicroPythonRepl | null = null
  private termRunning = false

  private state: DeviceState = {
    supported: serialSupported(),
    phase: 'idle',
    status: serialSupported() ? 'kein ESP32' : 'Web Serial nicht unterstützt',
    flashPct: 0,
    busy: false,
    log: [],
    terminal: [],
  }
  private listeners = new Set<() => void>()

  constructor() {
    if (serialSupported()) {
      navigator.serial.addEventListener('disconnect', (e: Event) => {
        // Nur reagieren, wenn unser Port abgezogen wurde.
        if ((e as unknown as { target?: SerialPort }).target === this.port) this.onLost()
      })
    }
  }

  // ---------------- Store-Anbindung (useSyncExternalStore) ----------------

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  getState = (): DeviceState => this.state

  private set(patch: Partial<DeviceState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }
  private log(msg: string): void {
    this.set({ log: [...this.state.log, msg].slice(-CAP) })
  }
  private term(text: string): void {
    this.set({ terminal: [...this.state.terminal, text].slice(-CAP) })
  }
  clearTerminal(): void {
    this.set({ terminal: [] })
  }
  clearLog(): void {
    this.set({ log: [] })
  }

  // ---------------- Abläufe ----------------

  /** Port vom Nutzer anfordern, öffnen und erkennen. */
  async connect(): Promise<void> {
    if (!this.state.supported) {
      this.log('Dieser Browser hat keine Web Serial API (Chrome/Edge nötig, über HTTPS oder localhost).')
      return
    }
    if (this.state.busy) return
    this.set({ busy: true, phase: 'connecting', status: 'verbinde…' })
    try {
      const port = await requestPort()
      this.port = port
      await this.openAndDetect()
    } catch (e) {
      // Abbruch im Port-Dialog ist kein Fehler.
      this.log(`Verbindung abgebrochen: ${errMsg(e)}`)
      this.set({ phase: this.port ? this.state.phase : 'idle', status: this.port ? this.state.status : 'kein ESP32' })
    } finally {
      this.set({ busy: false })
    }
  }

  private async openAndDetect(): Promise<void> {
    if (!this.port) return
    this.link = new SerialLink(this.port)
    await this.link.open(115200)
    this.repl = new MicroPythonRepl(this.link)
    this.log('Verbunden. Prüfe auf MicroPython…')
    const mp = await this.repl.isMicroPython()
    if (mp) {
      const machine = await this.repl.machine().catch(() => null)
      this.log(`✓ MicroPython erkannt${machine ? ` (${machine})` : ''}.`)
      this.set({ phase: 'connected', status: `verbunden${machine ? ` · ${machine.split(' ')[0]}` : ''}` })
    } else {
      this.log('ESP32 ohne MicroPython — bitte installieren.')
      this.set({ phase: 'nomp', status: 'ohne MicroPython' })
    }
  }

  /** Erst-Flashen der MicroPython-Firmware (esptool-js). */
  async install(board: Board): Promise<void> {
    if (!this.port || this.state.busy) return
    this.set({ busy: true, phase: 'flashing', status: 'flashe…', flashPct: 0 })
    this.stopTerminal()
    try {
      this.log(`Lade Firmware für ${board.name}…`)
      const fw = await loadFirmware(board)
      // Port für esptool freigeben.
      if (this.link) {
        await this.link.close()
        this.link = null
        this.repl = null
      }
      const { flashFirmware } = await import('./flash')
      await flashFirmware(this.port, board, fw, {
        log: (m) => this.log(m),
        progress: (pct) => this.set({ flashPct: pct, status: `flashe… ${pct} %` }),
      })
      // Nach dem Flashen neu verbinden und erkennen.
      this.log('Neu verbinden…')
      await this.openAndDetect()
    } catch (e) {
      this.log(`Flashen fehlgeschlagen: ${errMsg(e)}`)
      this.set({ phase: this.link ? 'connected' : 'nomp', status: 'Flashen fehlgeschlagen' })
      // Verbindung wiederherstellen, falls der Flasher sie ließ.
      if (!this.link && this.port) await this.openAndDetect().catch(() => {})
    } finally {
      this.set({ busy: false, flashPct: 0 })
    }
  }

  /** Zusammengebaute main.py übertragen und starten; danach Terminal mitlesen. */
  async run(mainPy: string): Promise<void> {
    if (!this.repl || !this.link || this.state.busy) return
    if (this.state.phase === 'nomp') {
      this.log('Kein MicroPython — erst installieren.')
      return
    }
    this.set({ busy: true, status: 'übertrage…' })
    this.stopTerminal()
    try {
      this.log(`Übertrage main.py (${mainPy.length} Zeichen)…`)
      const ok = await this.repl.uploadMain(mainPy, (m) => this.log(m))
      if (!ok) {
        this.set({ status: 'Übertragung fehlgeschlagen' })
        return
      }
      this.log('Starte (Soft-Reset)… Ausgabe im Terminal.')
      await this.repl.softReset()
      this.set({ phase: 'running', status: 'läuft' })
      this.startTerminal()
    } catch (e) {
      this.log(`Fehler: ${errMsg(e)}`)
    } finally {
      this.set({ busy: false })
    }
  }

  /** Eine Zeile an den ESP32 senden (wie Arduino-SerMonitor). */
  async sendLine(text: string): Promise<void> {
    if (!this.link) return
    await this.link.writeString(text + '\r\n')
    this.term(`» ${text}`)
  }

  async disconnect(): Promise<void> {
    this.stopTerminal()
    if (this.link) await this.link.close()
    this.link = null
    this.repl = null
    this.port = null
    this.set({ phase: 'idle', status: 'kein ESP32' })
  }

  // ---------------- Terminal-Leseschleife ----------------

  private startTerminal(): void {
    if (this.termRunning || !this.link) return
    this.termRunning = true
    const dec = new TextDecoder()
    let buf = ''
    void (async () => {
      while (this.termRunning && this.link) {
        const c = await this.link.readChunk(200)
        if (c === null) continue
        buf += dec.decode(c, { stream: true })
        let nl = buf.indexOf('\n')
        while (nl >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, '')
          this.term(line)
          buf = buf.slice(nl + 1)
          nl = buf.indexOf('\n')
        }
      }
    })()
  }

  private stopTerminal(): void {
    this.termRunning = false
  }

  private onLost(): void {
    this.stopTerminal()
    this.link = null
    this.repl = null
    this.port = null
    this.log('ESP32 abgezogen.')
    this.set({ phase: 'idle', status: 'kein ESP32' })
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Singleton — eine Geräteverbindung je App.
export const device = new WebDevice()
