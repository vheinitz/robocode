package de.robocode

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import kotlin.math.max
import kotlin.math.min

/**
 * Minimaler esptool-Protokoll-Client für den ROM-Bootloader des ESP32.
 *
 * Spricht den First-Stage-ROM-Bootloader direkt über UART/USB-CDC an – ohne
 * Stub-Loader und ohne Kompression. Bewusst klein gehalten: SYNC-Handshake,
 * SPI_ATTACH, FLASH_BEGIN/DATA/END und MD5-Verify. Das reicht, um ein
 * (vorzugsweise mit `esptool merge_bin` erzeugtes) Image @ Offset 0x0 zu
 * schreiben.
 *
 * Voraussetzung: Das Board ist bereits im Download-Modus (BOOT halten, EN/RESET
 * drücken, BOOT loslassen). Die Reset-Leitungen steuert diese Klasse NICHT –
 * das macht der Anwender manuell auf Ansage der App.
 *
 * Nicht unterstützt: ESP8266 (anderes Status-Byte-Layout), Stub/Kompression,
 * Flash-Verschlüsselung, Baudratenwechsel.
 *
 * Protokollreferenz: Espressif esptool „Serial Protocol".
 */
class EspLoader(private val io: Io) {

    /** Schmale IO-Abstraktion, damit der Client vom USB-Treiber entkoppelt ist. */
    interface Io {
        /** Rohbytes schreiben (blockierend mit eigenem Timeout im Treiber). */
        fun writeRaw(data: ByteArray)
        /** Bis zu buf.size Bytes lesen. Rückgabe: Anzahl (<=0 = nichts/Timeout). */
        fun readRaw(buf: ByteArray, timeoutMs: Int): Int
        /** Treiberpuffer leeren (best effort). */
        fun purge()
    }

    interface Listener {
        fun log(msg: String)
        fun progress(doneBytes: Int, totalBytes: Int)
    }

    /**
     * Länge der Status-Bytes am Ende jeder Antwort – wird aus der SYNC-Antwort
     * ermittelt (2 = ESP32 klassisch, 4 = ESP32-S2/S3/C3/…). Steuert zugleich,
     * ob FLASH_BEGIN das zusätzliche „encrypted"-Wort braucht (nur neuere ROMs).
     */
    private var statusLen = 4

    /** Kurzinfo zum erkannten Chip (nur Anzeige, best effort). */
    var chipInfo: String = "unbekannt"
        private set

    /**
     * Ob FLASH_BEGIN im ROM-Modus das zusätzliche „encrypted"-Wort braucht.
     * Gilt für ESP32-S2/S3/C3/… – NICHT für den klassischen ESP32. Default true,
     * da das Hauptziel dieser App ein C3/S3 ist; wird in [detectChip] präzisiert.
     */
    private var romNeedsEncryptFlag = true

    // ---------------- öffentliche Abläufe ----------------

    /** SYNC-Handshake mit dem ROM-Bootloader. true = Bootloader antwortet. */
    fun connect(listener: Listener): Boolean {
        val sync = ByteArray(36) { 0x55.toByte() }.also {
            it[0] = 0x07.toByte(); it[1] = 0x07.toByte()
            it[2] = 0x12.toByte(); it[3] = 0x20.toByte()
        }
        repeat(SYNC_ATTEMPTS) { attempt ->
            io.purge()
            drainFor(50)
            io.writeRaw(slipEncode(packet(CMD_SYNC, sync)))
            val resp = awaitResponse(CMD_SYNC, 120)
            if (resp != null) {
                statusLen = if (resp.data.size == 2) 2 else 4
                // Die restlichen (bis zu 7) SYNC-Echos wegräumen.
                repeat(7) { readFrame(40) }
                chipInfo = detectChip()
                listener.log("Bootloader antwortet (Status-Bytes=$statusLen, Chip: $chipInfo)")
                return true
            }
            if (attempt == SYNC_ATTEMPTS / 2) listener.log("Noch keine Antwort – Board im Download-Modus?")
        }
        return false
    }

    /**
     * Image in den Flash schreiben. [offset] ist der Ziel-Offset (bei Merged-Bin
     * 0x0). Gibt true bei Erfolg inkl. MD5-Verifikation zurück.
     */
    fun flash(image: ByteArray, offset: Int, listener: Listener): Boolean {
        // 1) SPI-Flash-Pins konfigurieren (ROM: 8-Byte-Argument, beide 0).
        if (!ok(awaitResponse(CMD_SPI_ATTACH, 3000) { io.writeRaw(slipEncode(packet(CMD_SPI_ATTACH, ByteArray(8)))) })) {
            listener.log("SPI_ATTACH fehlgeschlagen"); return false
        }

        // 2) Flash-Download-Modus einleiten (ROM erase der Region, kann dauern).
        val numBlocks = (image.size + FLASH_BLOCK - 1) / FLASH_BLOCK
        val beginSize = if (romNeedsEncryptFlag) 20 else 16
        val begin = le(beginSize).apply {
            putInt(image.size)      // zu löschende Größe = Imagegröße (ESP32)
            putInt(numBlocks)
            putInt(FLASH_BLOCK)
            putInt(offset)
            if (romNeedsEncryptFlag) putInt(0)   // encrypted = 0 (nur neuere ROMs)
        }
        listener.log("FLASH_BEGIN: ${image.size} Byte, $numBlocks Blöcke @ 0x%X".format(offset))
        if (!ok(awaitResponse(CMD_FLASH_BEGIN, 30000) { io.writeRaw(slipEncode(packet(CMD_FLASH_BEGIN, begin.array()))) })) {
            listener.log("FLASH_BEGIN fehlgeschlagen"); return false
        }

        // 3) Blockweise schreiben.
        var seq = 0
        var pos = 0
        while (pos < image.size) {
            val end = min(pos + FLASH_BLOCK, image.size)
            val block = ByteArray(FLASH_BLOCK) { 0xFF.toByte() } // letzter Block mit 0xFF gepolstert
            System.arraycopy(image, pos, block, 0, end - pos)
            val header = le(16).apply { putInt(FLASH_BLOCK); putInt(seq); putInt(0); putInt(0) }
            val payload = header.array() + block
            val sent = awaitResponse(CMD_FLASH_DATA, 3000) {
                io.writeRaw(slipEncode(packet(CMD_FLASH_DATA, payload, checksum(block))))
            }
            if (!ok(sent)) { listener.log("FLASH_DATA: Block $seq fehlgeschlagen"); return false }
            pos = end; seq++
            listener.progress(pos, image.size)
        }
        listener.log("Alle $seq Blöcke geschrieben")

        // 4) MD5 verifizieren.
        val deviceMd5 = flashMd5(offset, image.size)
        val localMd5 = md5Hex(image)
        if (deviceMd5 == null) {
            listener.log("MD5 vom Gerät nicht lesbar – ungeprüft");
        } else if (!deviceMd5.equals(localMd5, ignoreCase = true)) {
            listener.log("MD5 WEICHT AB!\n  Gerät: $deviceMd5\n  lokal: $localMd5")
            flashEnd(reboot = false)
            return false
        } else {
            listener.log("MD5 ok: $localMd5")
        }

        // 5) Abschließen und neue Firmware starten.
        flashEnd(reboot = true)
        listener.log("FLASH_END – Board startet die neue Firmware")
        return true
    }

    // ---------------- einzelne Kommandos ----------------

    private fun flashEnd(reboot: Boolean) {
        // Datenwort: 0 = neu starten, 1 = im Bootloader bleiben.
        val data = le(4).apply { putInt(if (reboot) 0 else 1) }.array()
        awaitResponse(CMD_FLASH_END, 2000) { io.writeRaw(slipEncode(packet(CMD_FLASH_END, data))) }
    }

    private fun flashMd5(addr: Int, size: Int): String? {
        val data = le(16).apply { putInt(addr); putInt(size); putInt(0); putInt(0) }.array()
        val resp = awaitResponse(CMD_SPI_FLASH_MD5, 8000) {
            io.writeRaw(slipEncode(packet(CMD_SPI_FLASH_MD5, data)))
        } ?: return null
        if (resp.data.size < statusLen) return null
        val status = resp.data[resp.data.size - statusLen].toInt() and 0xFF
        if (status != 0) return null
        val body = resp.data.copyOfRange(0, resp.data.size - statusLen)
        return when (body.size) {
            32 -> String(body, Charsets.US_ASCII)                        // ROM: ASCII-Hex
            16 -> body.joinToString("") { "%02x".format(it.toInt() and 0xFF) } // Stub: roh
            else -> null
        }
    }

    /** Best-effort-Chiperkennung über das Magic-Register. Nur zur Anzeige. */
    private fun detectChip(): String {
        val resp = awaitResponse(CMD_READ_REG, 1500) {
            io.writeRaw(slipEncode(packet(CMD_READ_REG, le(4).apply { putInt(CHIP_MAGIC_REG) }.array())))
        } ?: return "unbekannt"
        // Der klassische ESP32 braucht das FLASH_BEGIN-encrypted-Wort NICHT,
        // alle neueren Chips schon.
        romNeedsEncryptFlag = resp.value != ESP32_CLASSIC_MAGIC
        return when (resp.value) {
            ESP32_CLASSIC_MAGIC -> "ESP32"
            0x000007c6 -> "ESP32-S2"
            else -> "0x%08X (ESP32-Familie)".format(resp.value)
        }
    }

    // ---------------- Antwort-Handling ----------------

    private data class Resp(val op: Int, val value: Int, val data: ByteArray)

    /** true, wenn Antwort vorhanden und ihr Fehler-Status-Byte 0 ist. */
    private fun ok(resp: Resp?): Boolean {
        if (resp == null || resp.data.size < statusLen) return false
        return (resp.data[resp.data.size - statusLen].toInt() and 0xFF) == 0
    }

    /**
     * [send] ausführen, dann SLIP-Antworten lesen, bis eine mit passendem Op
     * kommt oder [timeoutMs] abläuft. Fremde Frames (z. B. Boot-Log) werden
     * übersprungen.
     */
    private inline fun awaitResponse(op: Int, timeoutMs: Int, send: () -> Unit): Resp? {
        send()
        return awaitResponse(op, timeoutMs)
    }

    private fun awaitResponse(op: Int, timeoutMs: Int): Resp? {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val frame = readFrame(remaining(deadline)) ?: continue
            val resp = parse(frame) ?: continue
            if (resp.op == op) return resp
        }
        return null
    }

    private fun parse(frame: ByteArray): Resp? {
        if (frame.size < 8) return null
        if (frame[0].toInt() and 0xFF != 0x01) return null   // Richtung: Antwort
        val op = frame[1].toInt() and 0xFF
        val size = (frame[2].toInt() and 0xFF) or ((frame[3].toInt() and 0xFF) shl 8)
        val value = ByteBuffer.wrap(frame, 4, 4).order(ByteOrder.LITTLE_ENDIAN).int
        val dataLen = min(size, frame.size - 8)
        val data = frame.copyOfRange(8, 8 + max(0, dataLen))
        return Resp(op, value, data)
    }

    // ---------------- SLIP-Rahmen ----------------

    /** Ein Kommando-Paket bauen (Richtung 0x00, Op, Größe, Prüfsumme, Daten). */
    private fun packet(op: Int, data: ByteArray, checksum: Int = 0): ByteArray {
        val header = le(8).apply {
            put(0.toByte())        // Richtung: Anfrage
            put(op.toByte())
            putShort(data.size.toShort())
            putInt(checksum)
        }
        return header.array() + data
    }

    private fun slipEncode(payload: ByteArray): ByteArray {
        val out = ArrayList<Byte>(payload.size + 8)
        out.add(0xC0.toByte())
        for (b in payload) when (b) {
            0xC0.toByte() -> { out.add(0xDB.toByte()); out.add(0xDC.toByte()) }
            0xDB.toByte() -> { out.add(0xDB.toByte()); out.add(0xDD.toByte()) }
            else -> out.add(b)
        }
        out.add(0xC0.toByte())
        return out.toByteArray()
    }

    // Leseseite: gepufferter SLIP-Frame-Leser.
    private var rx = ByteArray(0)
    private var rxPos = 0

    private fun fill(timeoutMs: Int): Boolean {
        if (rxPos < rx.size) return true
        val tmp = ByteArray(4096)
        val n = io.readRaw(tmp, max(1, timeoutMs))
        if (n <= 0) return false
        rx = tmp.copyOf(n); rxPos = 0
        return true
    }

    private fun nextByte(timeoutMs: Int): Int {
        if (!fill(timeoutMs)) return -1
        return rx[rxPos++].toInt() and 0xFF
    }

    /** Einen vollständigen, ent-escapten SLIP-Frame lesen (ohne die 0xC0). */
    private fun readFrame(timeoutMs: Int): ByteArray? {
        val deadline = System.currentTimeMillis() + timeoutMs
        // Auf Rahmenanfang 0xC0 warten.
        var b = nextByte(remaining(deadline))
        while (b != 0xC0) { if (b < 0) return null; b = nextByte(remaining(deadline)) }
        val out = ArrayList<Byte>(64)
        while (true) {
            b = nextByte(remaining(deadline))
            if (b < 0) return null
            when (b) {
                0xC0 -> if (out.isEmpty()) continue else return out.toByteArray() // Rahmenende
                0xDB -> {
                    val n = nextByte(remaining(deadline)); if (n < 0) return null
                    when (n) {
                        0xDC -> out.add(0xC0.toByte())
                        0xDD -> out.add(0xDB.toByte())
                        else -> { out.add(0xDB.toByte()); out.add(n.toByte()) }
                    }
                }
                else -> out.add(b.toByte())
            }
        }
    }

    /** Eingang für [ms] ms leerlesen (Boot-Geschwätz vor SYNC verwerfen). */
    private fun drainFor(ms: Int) {
        val deadline = System.currentTimeMillis() + ms
        val tmp = ByteArray(512)
        while (System.currentTimeMillis() < deadline) {
            if (io.readRaw(tmp, remaining(deadline)) <= 0) break
        }
        rx = ByteArray(0); rxPos = 0
    }

    private fun remaining(deadline: Long) = max(1, (deadline - System.currentTimeMillis()).toInt())

    // ---------------- kleine Helfer ----------------

    private fun le(n: Int): ByteBuffer = ByteBuffer.allocate(n).order(ByteOrder.LITTLE_ENDIAN)

    private fun checksum(data: ByteArray): Int {
        var s = CHECKSUM_MAGIC
        for (b in data) s = s xor (b.toInt() and 0xFF)
        return s
    }

    private fun md5Hex(data: ByteArray): String =
        MessageDigest.getInstance("MD5").digest(data).joinToString("") { "%02x".format(it.toInt() and 0xFF) }

    companion object {
        private const val SYNC_ATTEMPTS = 10
        private const val FLASH_BLOCK = 0x400          // ROM-Blockgröße (1024 Byte)
        private const val CHECKSUM_MAGIC = 0xEF
        private const val CHIP_MAGIC_REG = 0x40001000
        private const val ESP32_CLASSIC_MAGIC = 0x00f01d83

        // esptool-Kommando-Opcodes
        private const val CMD_FLASH_BEGIN = 0x02
        private const val CMD_FLASH_DATA = 0x03
        private const val CMD_FLASH_END = 0x04
        private const val CMD_SYNC = 0x08
        private const val CMD_READ_REG = 0x0A
        private const val CMD_SPI_ATTACH = 0x0D
        private const val CMD_SPI_FLASH_MD5 = 0x13
    }
}
