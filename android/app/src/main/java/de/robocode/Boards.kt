package de.robocode

/**
 * Board-Modell (nativer Port von src/hw/boards.ts). Welche GPIOs nutzbar und
 * welche ADC-fähig sind; daraus erzeugt der [Assembler] die versteckten
 * vordefinierten Pin-Objekte (D<gpio> für alle, A<gpio> für ADC-Pins).
 *
 * [firmwareAsset] ist der Dateiname der passenden MicroPython-Firmware unter
 * assets/firmware/ (muss von micropython.org dort abgelegt werden). C3/S3 nutzen
 * ein Merged-Bin @ Offset 0x0.
 */
data class Pin(val gpio: Int, val adc: Boolean = false, val strapping: Boolean = false)

/** Arduino-artige Bänke: Index -> GPIO. DO0.., DI0.., A0.. werden vorab erzeugt. */
data class Banks(val doPins: List<Int>, val diPins: List<Int>, val aPins: List<Int>)

data class Board(
    val id: String,
    val name: String,
    val chip: String,
    val flashOffset: Int,
    val firmwareAsset: String,
    val pins: List<Pin>,
    val banks: Banks,
) {
    /** Vordefinierte Pin-Zeilen für die versteckte DSL: zuerst die Arduino-Bänke
     *  (DO0.., DI0.., A0.. — im Namensraum, bevor MAIN läuft), dann die direkten
     *  GPIO-Namen D<gpio> für Fortgeschrittene. */
    fun predefinedPinLines(): String {
        val doLine = banks.doPins.mapIndexed { i, g -> "DO$i = DO($g)" }.joinToString("; ")
        val diLine = banks.diPins.mapIndexed { i, g -> "DI$i = DI($g)" }.joinToString("; ")
        val aLine = banks.aPins.mapIndexed { i, g -> "A$i = AI($g)" }.joinToString("; ")
        val d = pins.map { "D${it.gpio} = D(${it.gpio})" }
        fun chunk(xs: List<String>, n: Int) = xs.chunked(n).joinToString("\n") { it.joinToString("; ") }
        return buildString {
            append("# Arduino-Baenke — vorab erzeugt, stehen im Namensraum:\n")
            append("#   Ausgang setzen: DO1(1)  oder  DO1.v = 1\n")
            append("#   Eingang lesen:  k = DI1()   t = A0()\n")
            append(doLine); append("\n"); append(diLine); append("\n"); append(aLine)
            append("\n# Direkt per GPIO (fortgeschritten): D<gpio>\n"); append(chunk(d, 4))
        }
    }
}

object Boards {
    val ALL: List<Board> = listOf(
        Board(
            id = "esp32c3", name = "ESP32-C3", chip = "esp32c3", flashOffset = 0x0,
            firmwareAsset = "micropython-esp32c3.bin",
            pins = listOf(
                Pin(0, adc = true), Pin(1, adc = true), Pin(2, adc = true, strapping = true),
                Pin(3, adc = true), Pin(4, adc = true), Pin(5), Pin(6), Pin(7),
                Pin(8, strapping = true), Pin(9, strapping = true), Pin(10), Pin(20), Pin(21),
            ),
            banks = Banks(doPins = listOf(5, 6, 7, 8, 9, 10), diPins = listOf(20, 21), aPins = listOf(0, 1, 2, 3, 4)),
        ),
        Board(
            id = "esp32s3", name = "ESP32-S3", chip = "esp32s3", flashOffset = 0x0,
            firmwareAsset = "micropython-esp32s3.bin",
            pins = listOf(
                Pin(1, adc = true), Pin(2, adc = true), Pin(3, adc = true, strapping = true),
                Pin(4, adc = true), Pin(5, adc = true), Pin(6, adc = true), Pin(7, adc = true),
                Pin(8, adc = true), Pin(9, adc = true), Pin(10, adc = true),
                Pin(11), Pin(12), Pin(13), Pin(14), Pin(15), Pin(16), Pin(17), Pin(18), Pin(21),
                Pin(38), Pin(39), Pin(40), Pin(41), Pin(42), Pin(47), Pin(48),
            ),
            banks = Banks(doPins = listOf(11, 12, 13, 14, 15, 16), diPins = listOf(17, 18), aPins = listOf(1, 2, 3, 4, 5)),
        ),
    )

    fun byId(id: String): Board = ALL.firstOrNull { it.id == id } ?: ALL[0]
}
