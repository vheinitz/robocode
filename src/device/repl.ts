// MicroPython über den Raw-REPL — TS-Port von Androids MicroPythonRepl.kt.
//
// Spricht denselben ESP32 über dieselbe serielle Verbindung an (SerialLink),
// im Normalbetrieb (nicht Download-Modus). Kann erkennen, ob MicroPython läuft,
// die zusammengebaute main.py ins Dateisystem schreiben (base64-Chunks) und per
// Soft-Reset starten; die print()-Ausgabe liest danach das Terminal mit.
//
// Raw-REPL-Protokoll: Strg-C (0x03) unterbricht, Strg-A (0x01) betritt den
// Raw-REPL, Code + Strg-D (0x04) führt aus → "OK" + stdout + 0x04 + stderr +
// 0x04 + ">", Strg-B (0x02) zurück zum normalen REPL.

import { SerialLink } from './serial'

const CTRL_A = 0x01
const CTRL_B = 0x02
const CTRL_C = 0x03
const CTRL_D = 0x04

export type LogFn = (msg: string) => void

export class MicroPythonRepl {
  private rx: Uint8Array = new Uint8Array(0)
  private rxPos = 0

  constructor(private link: SerialLink) {}

  private async send(bytes: number[] | Uint8Array): Promise<void> {
    await this.link.write(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  }

  /** Laufendes Programm unterbrechen (zweimal Strg-C) und Puffer leeren. */
  async interrupt(): Promise<void> {
    await this.send([CTRL_C, CTRL_C])
    await this.drain(200)
  }

  /** Prüfen, ob MicroPython läuft: in den Raw-REPL wechseln und auf die Kennung warten. */
  async isMicroPython(timeoutMs = 3000): Promise<boolean> {
    await this.drain(300)
    await this.interrupt()
    await this.link.writeString('\r\n')
    await this.drain(150)
    await this.send([CTRL_A])
    let seen = await this.readContains('raw REPL', timeoutMs)
    await this.send([CTRL_B])
    if (!seen) {
      await this.link.writeString('\r\n')
      seen = await this.readContains('>>>', 1200)
    }
    await this.drain(150)
    return seen
  }

  /** MicroPython-Maschinenstring (os.uname().machine) zur Board-Erkennung. */
  async machine(): Promise<string | null> {
    await this.interrupt()
    if (!(await this.enterRaw(2000))) return null
    const s = await this.execCapture('import os\nprint(os.uname().machine)')
    await this.exitRaw()
    return s
  }

  /**
   * Zusammengebaute main.py ins Dateisystem schreiben (base64-Chunks, damit
   * Anführungszeichen/Zeilenumbrüche kein Problem sind).
   */
  async uploadMain(content: string, log: LogFn, fileName = 'main.py'): Promise<boolean> {
    await this.interrupt()
    if (!(await this.enterRaw(2000))) {
      log('Raw-REPL nicht erreichbar')
      return false
    }
    if (!(await this.exec('import ubinascii', log))) return false
    if (!(await this.exec(`f=open('${fileName}','wb')`, log))) return false

    const bytes = new TextEncoder().encode(content)
    const chunk = 240 // Rohbytes je Chunk → ~320 base64-Zeichen
    let pos = 0
    let n = 0
    while (pos < bytes.length) {
      const end = Math.min(pos + chunk, bytes.length)
      const b64 = base64(bytes.subarray(pos, end))
      if (!(await this.exec(`f.write(ubinascii.a2b_base64('${b64}'))`, log))) {
        log(`Schreiben bei Byte ${pos} fehlgeschlagen`)
        return false
      }
      pos = end
      n++
    }
    if (!(await this.exec('f.close()', log))) return false
    await this.exitRaw()
    log(`✓ ${fileName} geschrieben (${bytes.length} Byte in ${n} Chunks)`)
    return true
  }

  /** Soft-Reset: startet main.py neu (läuft dann auch bei jedem Boot). */
  async softReset(): Promise<void> {
    await this.send([CTRL_B])
    await this.drain(100)
    await this.send([CTRL_D])
  }

  // ---------------- Raw-REPL-Primitive ----------------

  private async enterRaw(timeoutMs: number): Promise<boolean> {
    await this.send([CTRL_A])
    return this.readContains('>', timeoutMs)
  }

  private async exitRaw(): Promise<void> {
    await this.send([CTRL_B])
    await this.drain(100)
  }

  private async exec(code: string, log: LogFn): Promise<boolean> {
    await this.link.writeString(code)
    await this.send([CTRL_D])
    if (!(await this.readContains('OK', 3000))) {
      log(`Keine OK-Antwort auf: ${code}`)
      return false
    }
    await this.readUntilByte(CTRL_D, 5000) // stdout verwerfen
    const err = await this.readUntilByte(CTRL_D, 5000) // stderr
    if (err && err.length) {
      const msg = new TextDecoder().decode(err).trim()
      if (msg) {
        log(`Fehler auf dem ESP32:\n${msg}`)
        return false
      }
    }
    return true
  }

  private async execCapture(code: string): Promise<string | null> {
    await this.link.writeString(code)
    await this.send([CTRL_D])
    if (!(await this.readContains('OK', 3000))) return null
    const out = await this.readUntilByte(CTRL_D, 3000)
    if (out === null) return null
    await this.readUntilByte(CTRL_D, 2000) // stderr verwerfen
    return new TextDecoder().decode(out).trim()
  }

  // ---------------- gepufferter Byte-Leser ----------------

  private async fill(timeoutMs: number): Promise<boolean> {
    if (this.rxPos < this.rx.length) return true
    const c = await this.link.readChunk(Math.max(1, timeoutMs))
    if (c === null || c.length === 0) return false
    this.rx = c
    this.rxPos = 0
    return true
  }

  private async nextByte(timeoutMs: number): Promise<number> {
    if (!(await this.fill(timeoutMs))) return -1
    return this.rx[this.rxPos++]
  }

  private async readContains(sub: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    let window = ''
    while (Date.now() < deadline) {
      const b = await this.nextByte(deadline - Date.now())
      if (b < 0) continue
      window += String.fromCharCode(b)
      if (window.length > 256) window = window.slice(-256)
      if (window.includes(sub)) return true
    }
    return false
  }

  private async readUntilByte(target: number, timeoutMs: number): Promise<Uint8Array | null> {
    const deadline = Date.now() + timeoutMs
    const out: number[] = []
    while (Date.now() < deadline) {
      const b = await this.nextByte(deadline - Date.now())
      if (b < 0) continue
      if (b === target) return Uint8Array.from(out)
      out.push(b)
    }
    return Uint8Array.from(out)
  }

  private async drain(ms: number): Promise<void> {
    await this.link.drain(ms)
    this.rx = new Uint8Array(0)
    this.rxPos = 0
  }
}

/** Uint8Array → base64 (ohne Zeilenumbrüche), browser-nativ via btoa. */
function base64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
