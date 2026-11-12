// MicroPython-Firmware fürs Browser-Flashen beschaffen.
//
// Die .bin-Dateien liegen NICHT im Repo (zu groß); sie werden per
// scripts/fetch-firmware.sh nach public/firmware/ geholt (wie bei Android).
// Fehlt die Datei, meldet der Flasher das freundlich — Erst-Flashen geht dann
// über die Android-App (die designierte Erst-Flasher-Rolle, siehe README).

import { Board } from '../hw/boards'

/** Dateiname der passenden Firmware unter public/firmware/ (je Chip). */
export function firmwareFile(board: Board): string {
  // C3 und S3 haben je ein Merged-Image @0x0 (micropython.org).
  return `micropython-${board.chip}.bin`
}

export function firmwareUrl(board: Board): string {
  return `${import.meta.env.BASE_URL}firmware/${firmwareFile(board)}`
}

/** Firmware laden; wirft mit klarer Meldung, wenn sie (noch) nicht da ist. */
export async function loadFirmware(board: Board): Promise<Uint8Array> {
  const url = firmwareUrl(board)
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new Error(`Firmware nicht erreichbar (${firmwareFile(board)}).`)
  }
  if (!res.ok) {
    throw new Error(
      `Firmware fehlt: ${firmwareFile(board)} — hole sie mit scripts/fetch-firmware.sh ` +
        `oder flashe erstmalig mit der Android-App.`,
    )
  }
  return new Uint8Array(await res.arrayBuffer())
}
