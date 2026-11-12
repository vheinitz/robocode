// Erst-Flashen der MicroPython-Firmware aus dem Browser — via esptool-js.
//
// esptool-js spricht den ROM-Bootloader über Web Serial an (eigene Transport-
// Klasse). Darum muss der Port VORHER frei sein (SerialLink.close()), danach
// baut der Controller eine frische SerialLink für den REPL auf.
//
// Rollenhinweis: laut Rollenverteilung ist die Android-APK der primäre
// Erst-Flasher; der Browser-Flasher hier ist die Web-Variante derselben Rolle.

import { ESPLoader, Transport } from 'esptool-js'
import { Board } from '../hw/boards'

export interface FlashCallbacks {
  log: (msg: string) => void
  /** 0..100 */
  progress: (pct: number) => void
}

/**
 * Firmware auf den ESP32 flashen. Der [port] muss geschlossen/entsperrt sein.
 * Gibt zurück, wenn die Firmware vollständig geschrieben und das Board neu
 * gestartet ist.
 */
export async function flashFirmware(
  port: SerialPort,
  board: Board,
  firmware: Uint8Array,
  cb: FlashCallbacks,
): Promise<void> {
  const transport = new Transport(port, false)
  const terminal = {
    clean: () => {},
    writeLine: (d: string) => cb.log(d),
    write: () => {},
  }
  const loader = new ESPLoader({
    transport,
    baudrate: 115200,
    romBaudrate: 115200, // gleich → kein Port-Reopen, stört die EN/IO0-Leitungen nicht
    terminal,
  })

  try {
    cb.log('Verbinde mit ROM-Bootloader…')
    await loader.main() // synchronisiert, erkennt Chip
    cb.log(`Flashe ${board.name} (${firmware.length} Byte)…`)
    await loader.writeFlash({
      fileArray: [{ data: firmware, address: board.flashOffset }],
      flashSize: 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (_i, written, total) => cb.progress(Math.round((written / total) * 100)),
    })
    cb.log('✓ MicroPython geschrieben. Starte neu…')
    await loader.after('hard_reset')
  } finally {
    try {
      await transport.disconnect()
    } catch {
      /* egal */
    }
  }
}
