package de.robocode

import android.util.Base64
import kotlin.math.max

/**
 * MicroPython über den Raw-REPL ansprechen — auf derselben USB-CDC-Verbindung,
 * die auch zum Flashen dient ([UsbSerialLink]), nur im Normalbetrieb (NICHT im
 * Download-Modus).
 *
 * Kann:
 *  - erkennen, ob auf dem ESP32 MicroPython läuft ([isMicroPython]),
 *  - die zusammengebaute main.py ins Dateisystem schreiben ([uploadMain]) —
 *    in base64-Chunks, damit Anführungszeichen/Zeilenumbrüche kein Problem sind,
 *  - per Soft-Reset starten ([softReset]) und die print()-Ausgabe mitlesen
 *    ([follow]).
 *
 * Raw-REPL-Protokoll (MicroPython):
 *   Strg-C (0x03) unterbricht ein laufendes Programm.
 *   Strg-A (0x01) betritt den Raw-REPL  -> "raw REPL; CTRL-B to exit\r\n>".
 *   Code senden, dann Strg-D (0x04) ausführen -> "OK" + stdout + 0x04 + stderr +
 *   0x04 + ">". Strg-B (0x02) kehrt zum normalen REPL zurück.
 */
class MicroPythonRepl(private val link: UsbSerialLink) {

    interface Listener {
        fun log(msg: String)
    }

    // ---------------- öffentliche Abläufe ----------------

    /** Laufendes Programm unterbrechen (zweimal Strg-C) und Puffer leeren. */
    fun interrupt() {
        link.writeRaw(byteArrayOf(CTRL_C, CTRL_C))
        drain(200)
    }

    /**
     * Prüfen, ob MicroPython läuft: in den Raw-REPL wechseln und auf dessen
     * Kennung warten. Danach zurück in den normalen REPL.
     */
    fun isMicroPython(timeoutMs: Int = 2000): Boolean {
        interrupt()
        link.writeRaw(byteArrayOf(CTRL_A))
        val seen = readContains("raw REPL", timeoutMs)
        link.writeRaw(byteArrayOf(CTRL_B))
        drain(150)
        return seen
    }

    /**
     * Die zusammengebaute main.py ins Dateisystem schreiben. Überträgt den Inhalt
     * in base64-Chunks und hält dabei die Datei im REPL-Namensraum offen.
     * Gibt true bei Erfolg zurück.
     */
    fun uploadMain(content: String, listener: Listener, fileName: String = "main.py"): Boolean {
        interrupt()
        if (!enterRaw(2000)) { listener.log("Raw-REPL nicht erreichbar"); return false }

        if (!exec("import ubinascii", listener)) return false
        if (!exec("f=open('$fileName','wb')", listener)) return false

        val bytes = content.toByteArray(Charsets.UTF_8)
        val chunk = 240 // Rohbytes je Chunk -> ~320 base64-Zeichen
        var pos = 0
        var n = 0
        while (pos < bytes.size) {
            val end = minOf(pos + chunk, bytes.size)
            val b64 = Base64.encodeToString(bytes.copyOfRange(pos, end), Base64.NO_WRAP)
            if (!exec("f.write(ubinascii.a2b_base64('$b64'))", listener)) {
                listener.log("Schreiben bei Byte $pos fehlgeschlagen"); return false
            }
            pos = end; n++
        }
        if (!exec("f.close()", listener)) return false
        exitRaw()
        listener.log("✓ $fileName geschrieben (${bytes.size} Byte in $n Chunks)")
        return true
    }

    /** Soft-Reset: startet main.py neu (läuft dann auch bei jedem Boot). */
    fun softReset() {
        // In den normalen REPL wechseln, dann Strg-D = Soft-Reboot.
        link.writeRaw(byteArrayOf(CTRL_B))
        drain(100)
        link.writeRaw(byteArrayOf(CTRL_D))
    }

    /** Serielle Ausgabe (print()) für [durationMs] mitlesen und an [listener]. */
    fun follow(durationMs: Int, listener: Listener) {
        val deadline = System.currentTimeMillis() + durationMs
        val sb = StringBuilder()
        val buf = ByteArray(1024)
        while (System.currentTimeMillis() < deadline) {
            val got = link.readRaw(buf, 200)
            if (got <= 0) continue
            sb.append(String(buf, 0, got, Charsets.UTF_8))
            var idx = sb.indexOf("\n")
            while (idx >= 0) {
                val line = sb.substring(0, idx).trimEnd('\r')
                if (line.isNotEmpty()) listener.log(line)
                sb.delete(0, idx + 1)
                idx = sb.indexOf("\n")
            }
        }
        if (sb.isNotEmpty()) listener.log(sb.toString().trimEnd())
    }

    // ---------------- Raw-REPL-Primitive ----------------

    private fun enterRaw(timeoutMs: Int): Boolean {
        link.writeRaw(byteArrayOf(CTRL_A))
        return readContains(">", timeoutMs)
    }

    private fun exitRaw() {
        link.writeRaw(byteArrayOf(CTRL_B))
        drain(100)
    }

    /**
     * Eine Anweisung im Raw-REPL ausführen. Erwartet "OK" + stdout + 0x04 +
     * stderr + 0x04. Bei nicht-leerem stderr wird der Fehler geloggt.
     */
    private fun exec(code: String, listener: Listener): Boolean {
        link.writeRaw(code.toByteArray(Charsets.UTF_8))
        link.writeRaw(byteArrayOf(CTRL_D))
        if (!readContains("OK", 3000)) { listener.log("Keine OK-Antwort auf: $code"); return false }
        readUntilByte(CTRL_D.toInt(), 5000) // stdout verwerfen
        val err = readUntilByte(CTRL_D.toInt(), 5000) // stderr
        if (err != null && err.isNotEmpty()) {
            val msg = String(err, Charsets.UTF_8).trim()
            if (msg.isNotEmpty()) { listener.log("Fehler auf dem ESP32:\n$msg"); return false }
        }
        return true
    }

    // ---------------- gepufferter Byte-Leser ----------------

    private var rx = ByteArray(0)
    private var rxPos = 0

    private fun fill(timeoutMs: Int): Boolean {
        if (rxPos < rx.size) return true
        val tmp = ByteArray(2048)
        val n = link.readRaw(tmp, max(1, timeoutMs))
        if (n <= 0) return false
        rx = tmp.copyOf(n); rxPos = 0
        return true
    }

    private fun nextByte(timeoutMs: Int): Int {
        if (!fill(timeoutMs)) return -1
        return rx[rxPos++].toInt() and 0xFF
    }

    /** Lesen, bis die ASCII-Teilzeichenkette [sub] gesehen wurde (oder Timeout). */
    private fun readContains(sub: String, timeoutMs: Int): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        val sb = StringBuilder()
        while (System.currentTimeMillis() < deadline) {
            val b = nextByte(remaining(deadline))
            if (b < 0) continue
            sb.append(b.toChar())
            if (sb.length > 256) sb.delete(0, sb.length - 256) // rollendes Fenster
            if (sb.contains(sub)) return true
        }
        return false
    }

    /** Bytes bis zum Zielbyte [target] sammeln (ohne das Zielbyte). */
    private fun readUntilByte(target: Int, timeoutMs: Int): ByteArray? {
        val deadline = System.currentTimeMillis() + timeoutMs
        val out = ArrayList<Byte>(64)
        while (System.currentTimeMillis() < deadline) {
            val b = nextByte(remaining(deadline))
            if (b < 0) continue
            if (b == target) return out.toByteArray()
            out.add(b.toByte())
        }
        return out.toByteArray()
    }

    private fun drain(ms: Int) {
        val deadline = System.currentTimeMillis() + ms
        val tmp = ByteArray(1024)
        while (System.currentTimeMillis() < deadline) {
            if (link.readRaw(tmp, remaining(deadline)) <= 0) break
        }
        rx = ByteArray(0); rxPos = 0
    }

    private fun remaining(deadline: Long) = max(1, (deadline - System.currentTimeMillis()).toInt())

    companion object {
        private const val CTRL_A: Byte = 0x01
        private const val CTRL_B: Byte = 0x02
        private const val CTRL_C: Byte = 0x03
        private const val CTRL_D: Byte = 0x04
    }
}
