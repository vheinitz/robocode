package de.robocode

/**
 * Board-Modell (nativer Port von src/hw/boards.ts). Welche GPIOs nutzbar und
 * welche ADC-fähig sind; daraus erzeugt der [Assembler] die versteckten
 * vordefinierten Pin-Objekte (D<gpio> für alle, A<gpio> für ADC-Pins).
 *
 * [firmwareAsset] ist der Dateiname der passenden MicroPython-Firmware unter
 * assets/firmware/ (muss von micropython.org dort abgelegt werden). C3/S3 nutzen
 * ein Merged-Bin @ Offset 0x0.
 *
 * [image] (unter assets/boards/) und [layout] tragen die Board-Ansicht (0.2):
 * physische Pin-Anordnung, Platine von oben, USB-C oben — Quelle: espboards.dev.
 */
data class Pin(val gpio: Int, val adc: Boolean = false, val strapping: Boolean = false, val note: String? = null)

/** Arduino-artige Bänke: Index -> GPIO. DO0.., DI0.., A0.. werden vorab erzeugt. */
data class Banks(val doPins: List<Int>, val diPins: List<Int>, val aPins: List<Int>)

/** Bedeutung eines Pins in der Projekt-Belegung (0.2). */
enum class PinRole(val code: String, val label: String) {
    A("A", "Analog-Eingang"), DI("DI", "Digital-Eingang"), DO("DO", "Digital-Ausgang"),
    SDA("SDA", "I²C SDA"), SCL("SCL", "I²C SCL"), SPI("SPI", "SPI"), INT("INT", "Interrupt"),
    NONE("—", "—");

    companion object {
        /** Nur diese Rollen sind pro Pin frei wählbar (I²C/SPI/INT sind hardware-
         *  gebunden). Reihenfolge wie im Web-Spinner. */
        val EDITABLE = listOf(DO, DI, A, NONE)
        val RESERVED = listOf(SDA, SCL, SPI, INT)
    }
}

/** Ein physischer Pin-Platz in der Board-Ansicht: GPIO (editierbar) oder fester
 *  Versorgungspin (5V/GND/3V3). */
data class Slot(val gpio: Int? = null, val power: String? = null)

/** Physische Pin-Anordnung (Platine von oben, USB-C oben): linke und rechte
 *  Stiftleiste je von oben nach unten. */
data class Layout(val left: List<Slot>, val right: List<Slot>)

/** Pin-Beschreibung mit Name/Rolle (A0.., DI0.., DO0.., sonst GPIOn). */
data class PinDesc(
    val gpio: Int,
    var name: String,
    var role: PinRole,
    val adc: Boolean,
    val note: String? = null,
)

data class Board(
    val id: String,
    val name: String,
    val chip: String,
    val flashOffset: Int,
    val firmwareAsset: String,
    val image: String? = null,
    val pins: List<Pin>,
    val banks: Banks,
    val layout: Layout,
) {
    /** Vordefinierte Pin-Zeilen für die versteckte DSL: zuerst die Arduino-Bänke
     *  (DO0.., DI0.., A0.. — im Namensraum, bevor MAIN läuft), dann die direkten
     *  GPIO-Namen D<gpio> für Fortgeschrittene. */
    fun predefinedPinLines(): String {
        fun arr(xs: List<Int>) = "[" + xs.joinToString(", ") + "]"
        val d = pins.map { "D${it.gpio} = D(${it.gpio})" }
        fun chunk(xs: List<String>, n: Int) = xs.chunked(n).joinToString("\n") { it.joinToString("; ") }
        return buildString {
            append("# Board `b` — schon da, bevor MAIN laeuft:\n")
            append("#   Ausgang:  b.do1 = 1   (0/1 = an/aus, jede andere Zahl = PWM 0..255)\n")
            append("#   Eingang:  t = b.a1    if b.di0:\n")
            append("b = Board(${arr(banks.doPins)}, ${arr(banks.diPins)}, ${arr(banks.aPins)})")
            append("\n# Direkt per GPIO (fortgeschritten): D<gpio>\n"); append(chunk(d, 4))
        }
    }

    /** Standard-Belegung dieses Boards: Bank-Index -> Default-Name/Rolle. */
    fun defaultPins(): List<PinDesc> = pins.map { p ->
        val ia = banks.aPins.indexOf(p.gpio)
        val ido = banks.doPins.indexOf(p.gpio)
        val idi = banks.diPins.indexOf(p.gpio)
        when {
            ia >= 0 -> PinDesc(p.gpio, "A$ia", PinRole.A, p.adc, p.note)
            ido >= 0 -> PinDesc(p.gpio, "DO$ido", PinRole.DO, p.adc, p.note)
            idi >= 0 -> PinDesc(p.gpio, "DI$idi", PinRole.DI, p.adc, p.note)
            p.note?.contains("SDA") == true -> PinDesc(p.gpio, "sda", PinRole.SDA, p.adc, p.note)
            p.note?.contains("SCL") == true -> PinDesc(p.gpio, "scl", PinRole.SCL, p.adc, p.note)
            else -> PinDesc(p.gpio, "GPIO${p.gpio}", PinRole.NONE, p.adc, p.note)
        }
    }
}

object Boards {
    val ALL: List<Board> = listOf(
        Board(
            id = "esp32c3", name = "ESP32-C3 SuperMini", chip = "esp32c3", flashOffset = 0x0,
            firmwareAsset = "micropython-esp32c3.bin",
            image = "boards/esp32-c3-supermini.png",
            pins = listOf(
                Pin(0, adc = true), Pin(1, adc = true), Pin(2, adc = true, strapping = true),
                Pin(3, adc = true), Pin(4, adc = true), Pin(5), Pin(6), Pin(7),
                Pin(8, strapping = true), Pin(9, strapping = true), Pin(10), Pin(20), Pin(21),
            ),
            banks = Banks(doPins = listOf(5, 6, 7, 8, 9, 10), diPins = listOf(20, 21), aPins = listOf(0, 1, 2, 3, 4)),
            layout = Layout(
                left = listOf(Slot(gpio = 5), Slot(gpio = 6), Slot(gpio = 7), Slot(gpio = 8), Slot(gpio = 9), Slot(gpio = 10), Slot(gpio = 20), Slot(gpio = 21)),
                right = listOf(Slot(power = "5V"), Slot(power = "GND"), Slot(power = "3V3"), Slot(gpio = 4), Slot(gpio = 3), Slot(gpio = 2), Slot(gpio = 1), Slot(gpio = 0)),
            ),
        ),
        Board(
            // Nur die obere Ansicht (espboards.dev/esp32/esp32-s3-super-mini): die
            // auf der Oberseite herausgeführten GPIOs. 43/44 = USB-Serielle.
            id = "esp32s3", name = "ESP32-S3 SuperMini", chip = "esp32s3", flashOffset = 0x0,
            firmwareAsset = "micropython-esp32s3.bin",
            image = "boards/esp32-s3-supermini.png",
            pins = listOf(
                Pin(1, adc = true), Pin(2, adc = true), Pin(3, adc = true, strapping = true, note = "Strapping"),
                Pin(4, adc = true), Pin(5, adc = true), Pin(6, adc = true), Pin(7, adc = true),
                Pin(8, adc = true), Pin(9, adc = true), Pin(10, adc = true),
                Pin(11, adc = true), Pin(12, adc = true), Pin(13, adc = true),
                Pin(43, note = "U0TXD"), Pin(44, note = "U0RXD"),
            ),
            banks = Banks(doPins = listOf(8, 9, 10, 11, 12, 13), diPins = listOf(6, 7), aPins = listOf(1, 2, 3, 4, 5)),
            layout = Layout(
                left = listOf(Slot(gpio = 43), Slot(gpio = 44), Slot(gpio = 1), Slot(gpio = 2), Slot(gpio = 3), Slot(gpio = 4), Slot(gpio = 5), Slot(gpio = 6), Slot(gpio = 7)),
                right = listOf(Slot(power = "5V"), Slot(power = "GND"), Slot(power = "3V3"), Slot(gpio = 13), Slot(gpio = 12), Slot(gpio = 11), Slot(gpio = 10), Slot(gpio = 9), Slot(gpio = 8)),
            ),
        ),
        Board(
            // Wie C3 SuperMini, aber mit onboard-OLED 0.42" (SSD1306, I²C auf
            // GPIO5/6). Deshalb GPIO5/6 nicht in den DO-Bänken (fürs Display reserviert).
            id = "esp32c3oled", name = "ESP32-C3 SuperMini OLED", chip = "esp32c3", flashOffset = 0x0,
            firmwareAsset = "micropython-esp32c3.bin",
            image = "boards/esp32-c3-supermini-oled-042.png",
            pins = listOf(
                Pin(0, adc = true), Pin(1, adc = true), Pin(2, adc = true, strapping = true),
                Pin(3, adc = true), Pin(4, adc = true),
                Pin(5, note = "OLED SDA (I²C)"), Pin(6, note = "OLED SCL (I²C)"), Pin(7),
                Pin(8, strapping = true), Pin(9, strapping = true), Pin(10), Pin(20), Pin(21),
            ),
            banks = Banks(doPins = listOf(7, 8, 9, 10), diPins = listOf(20, 21), aPins = listOf(0, 1, 2, 3, 4)),
            layout = Layout(
                left = listOf(Slot(power = "5V"), Slot(power = "GND"), Slot(power = "3V3"), Slot(gpio = 20), Slot(gpio = 21), Slot(gpio = 2), Slot(gpio = 1), Slot(gpio = 0)),
                right = listOf(Slot(gpio = 10), Slot(gpio = 9), Slot(gpio = 8), Slot(gpio = 7), Slot(gpio = 6), Slot(gpio = 5), Slot(gpio = 4), Slot(gpio = 3)),
            ),
        ),
    )

    fun byId(id: String): Board = ALL.firstOrNull { it.id == id } ?: ALL[0]

    /** Gültiger Python-Bezeichner? (für eigene Pin-Namen) */
    fun isValidName(s: String): Boolean = Regex("^[A-Za-z_][A-Za-z0-9_]*$").matches(s)

    /** Vordefinierte Zeilen aus einer EIGENEN Pin-Belegung (Projekt-Klon, 0.2).
     *  Nur A/DI/DO erzeugen direkt nutzbare Objekte. */
    fun customPinLines(pins: List<PinDesc>): String {
        fun ctor(role: PinRole, g: Int): String? = when (role) {
            PinRole.A -> "AI($g)"
            PinRole.DI -> "DI($g)"
            PinRole.DO -> "DO($g)"
            else -> null
        }
        val body = pins.filter { isValidName(it.name) && ctor(it.role, it.gpio) != null }
            .map { "${it.name} = ${ctor(it.role, it.gpio)}" }
        val i2c = pins.filter { it.role == PinRole.SDA || it.role == PinRole.SCL }
        val lines = mutableListOf("# ----- Eigene Pin-Namen (Board fuer dieses Projekt angepasst) -----")
        if (i2c.isNotEmpty()) {
            val sda = i2c.firstOrNull { it.role == PinRole.SDA }
            val scl = i2c.firstOrNull { it.role == PinRole.SCL }
            lines.add("# I2C: SDA=GPIO${sda?.gpio ?: "?"}, SCL=GPIO${scl?.gpio ?: "?"} (fuer Display/Sensor)")
        }
        if (body.isNotEmpty()) lines.addAll(body) else lines.add("# (keine eigenen Namen vergeben)")
        return lines.joinToString("\n")
    }
}
