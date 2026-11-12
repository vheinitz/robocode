// Web Serial — rohe serielle Verbindung zum ESP32 aus dem Browser (Chrome/Edge).
//
// Gegenstück zu Androids UsbSerialLink: hält einen offenen SerialPort, pumpt
// eingehende Bytes in einen Puffer und erlaubt rohes Schreiben/Lesen. Der
// MicroPython-REPL (repl.ts) und das Terminal lesen darüber; esptool-js bekommt
// beim Flashen den rohen Port (dafür muss diese Verbindung vorher close()-en,
// damit die Locks frei sind).

/** Hat dieser Browser die Web Serial API? (Chrome/Edge über HTTPS oder localhost.) */
export function serialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

/** Port vom Nutzer anfordern (öffnet den Browser-Dialog). */
export async function requestPort(): Promise<SerialPort> {
  return navigator.serial.requestPort()
}

export class SerialLink {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private chunks: Uint8Array[] = []
  private waiters: Array<() => void> = []
  private pumping = false

  constructor(public readonly port: SerialPort) {}

  get isOpen(): boolean {
    return this.reader !== null
  }

  async open(baudRate = 115200): Promise<void> {
    await this.port.open({ baudRate })
    this.reader = this.port.readable!.getReader()
    this.writer = this.port.writable!.getWriter()
    this.pumping = true
    void this.pump()
  }

  /** Verbindung schließen und alle Locks freigeben (nötig vor dem Flashen). */
  async close(): Promise<void> {
    this.pumping = false
    try {
      await this.reader?.cancel()
    } catch {
      /* egal */
    }
    try {
      this.reader?.releaseLock()
    } catch {
      /* egal */
    }
    try {
      this.writer?.releaseLock()
    } catch {
      /* egal */
    }
    this.reader = null
    this.writer = null
    try {
      await this.port.close()
    } catch {
      /* egal */
    }
    this.wake()
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('nicht verbunden')
    await this.writer.write(data)
  }

  writeString(s: string): Promise<void> {
    return this.write(new TextEncoder().encode(s))
  }

  /**
   * Nächsten verfügbaren Bytepuffer holen (alle gepufferten Chunks am Stück),
   * oder null nach [timeoutMs] ohne Daten.
   */
  async readChunk(timeoutMs: number): Promise<Uint8Array | null> {
    if (this.chunks.length === 0) {
      await this.waitForData(timeoutMs)
    }
    if (this.chunks.length === 0) return null
    const all = this.chunks
    this.chunks = []
    if (all.length === 1) return all[0]
    let len = 0
    for (const c of all) len += c.length
    const out = new Uint8Array(len)
    let o = 0
    for (const c of all) {
      out.set(c, o)
      o += c.length
    }
    return out
  }

  /** Puffer leeren und [ms] lang alles verwerfen (wie Androids drain). */
  async drain(ms: number): Promise<void> {
    const deadline = Date.now() + ms
    this.chunks = []
    while (Date.now() < deadline) {
      const c = await this.readChunk(Math.max(1, deadline - Date.now()))
      if (c === null) break
    }
    this.chunks = []
  }

  private async pump(): Promise<void> {
    const reader = this.reader
    if (!reader) return
    try {
      while (this.pumping) {
        const { value, done } = await reader.read()
        if (done) break
        if (value && value.length) {
          this.chunks.push(value)
          this.wake()
        }
      }
    } catch {
      /* Verbindung verloren/abgezogen */
    }
  }

  private waitForData(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(finish, Math.max(1, timeoutMs))
      this.waiters.push(finish)
    })
  }

  private wake(): void {
    const ws = this.waiters
    this.waiters = []
    for (const w of ws) w()
  }
}
