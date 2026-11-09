package de.robocode

/**
 * Baut die EINE main.py zusammen (nativer Port von src/hw/assemble.ts):
 * versteckte DSL (robopy) + vordefinierte Pins + SETUP + LIB + MAIN. Kein
 * Transpiler — SETUP/LIB/MAIN sind schon echtes MicroPython.
 */
object Assembler {

    data class Parts(val setup: String, val lib: String, val main: String)

    private fun section(title: String, body: String, fallback: String): String {
        val b = body.trim()
        return "# ----- $title -----\n" + b.ifEmpty { fallback }
    }

    /** [robopySource] stammt aus assets/dsl/robopy.py. */
    fun assemble(parts: Parts, board: Board, robopySource: String): String {
        val header = listOf(
            "# ======================================================================",
            "# main.py — zusammengebaut von RoboCode (nativ, EeZear-Stil, KEIN Transpiler)",
            "# Board: ${board.name} (${board.chip}, Flash-Offset 0x${board.flashOffset.toString(16)})",
            "# Aufbau: DSL (versteckt) + vordefinierte Pins + SETUP + LIB + MAIN.",
            "# ======================================================================",
        ).joinToString("\n")

        return listOf(
            header,
            "",
            "# ----- DSL-Bibliothek (versteckt; EeZear-Stil) -----",
            robopySource.trim(),
            "",
            "# ----- Vordefinierte Pins für ${board.name} (versteckt) -----",
            board.predefinedPinLines(),
            "",
            section("SETUP (Geräte an Pins)", parts.setup, "# (noch keine Geräte)"),
            "",
            section("LIB (eigene Funktionen)", parts.lib, "# (keine eigenen Funktionen)"),
            "",
            section("MAIN (Programm)", parts.main, "# (noch kein Programm)"),
            "",
        ).joinToString("\n")
    }
}
