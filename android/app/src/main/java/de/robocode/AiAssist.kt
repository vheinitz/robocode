package de.robocode

/**
 * Programmieren mit KI (P1). RoboCode bindet keine KI-API ein, sondern reicht
 * den Kontext per Intent/Zwischenablage an eine beliebige KI-App weiter und holt
 * die Antwort über die Zwischenablage zurück.
 *
 * Kern ist die Zuordnung über eine Anfrage-ID: RoboCode erzeugt die ID, bittet
 * die KI, sie als erste Code-Zeile zu wiederholen, und erkennt die Antwort
 * daran wieder. Diese reine Logik (Prompt bauen, Antwort herausschneiden) lebt
 * hier, ohne Android-Abhängigkeiten, damit sie testbar bleibt.
 */
object AiAssist {

    data class Request(val id: String, val prompt: String)

    private const val HEADER_PREFIX = "# RC-ID:"

    fun headerLine(id: String) = "$HEADER_PREFIX $id"

    /** Kurze, gut unterscheidbare Anfrage-ID, z. B. „RC-7Q3F2-514". */
    fun newRequestId(): String {
        val t = System.currentTimeMillis().toString(36).takeLast(5).uppercase()
        return "RC-$t-${(100..999).random()}"
    }

    /**
     * Baut den Prompt. Enthält die RoboCode-Regeln, die vorhandenen Board-Objekte
     * und optional das aktuelle Programm. Die Anfrage-ID steht als zu wiederholende
     * erste Code-Zeile am Ende.
     */
    fun buildPrompt(id: String, boardContext: String, currentProgram: String?): String {
        val sb = StringBuilder()
        sb.append("Du hilfst, einen ESP32 mit RoboCode zu programmieren. ")
        sb.append("RoboCode ist eine MicroPython-Variante für Kinder.\n\n")
        sb.append("Regeln:\n")
        sb.append("- Das Board-Objekt b ist bereits vorhanden. Nutze NUR die unten genannten Objekte; ")
        sb.append("lege selbst KEINE Pins an und importiere nichts für die Pins.\n")
        sb.append("- Digitalausgang schalten: b.do0 = 1 (an) bzw. b.do0 = 0 (aus).\n")
        sb.append("- Digitaleingang lesen: b.di0 (ergibt 0 oder 1).\n")
        sb.append("- Analogeingang lesen: b.a0 (ergibt eine Zahl).\n")
        sb.append("- Warten: wait(500) — Millisekunden.\n")
        sb.append("- Wert an die Tafel/Anzeige senden: log(\"NAME:\" + str(wert)).\n")
        sb.append("- Sonst normales Python: while True:, for, if/elif/else, def, Variablen.\n\n")
        sb.append("Vorhandene Board-Objekte:\n").append(boardContext.trimEnd()).append("\n\n")
        if (!currentProgram.isNullOrBlank()) {
            sb.append("Aktuelles Programm (darf erweitert oder geändert werden):\n")
            sb.append("```python\n").append(currentProgram.trim()).append("\n```\n\n")
        }
        sb.append("AUFGABE: … hier beschreibst du, was das Programm tun soll …\n\n")
        sb.append("Antworte mit genau einem Python-Codeblock und sonst nichts. ")
        sb.append("Die ALLERERSTE Zeile des Codes muss exakt dieser Kommentar sein:\n")
        sb.append(headerLine(id)).append("\n")
        return sb.toString()
    }

    /**
     * Schneidet aus einer Zwischenablage die Antwort zur Anfrage [id] heraus.
     *
     * - Gibt null zurück, wenn die Zwischenablage unverändert der gesendete Prompt
     *   ist (Nutzer hat nichts kopiert) oder die Anfrage-ID-Kopfzeile fehlt.
     * - Sonst den Code ab der Kopfzeile bis zu einem evtl. folgenden ```-Zaun.
     */
    fun extractAnswer(clipboard: String, id: String, sentPrompt: String?): String? {
        if (sentPrompt != null && clipboard.trim() == sentPrompt.trim()) return null
        val lines = clipboard.lines()
        val start = lines.indexOfFirst { it.trim() == headerLine(id) }
        if (start < 0) return null
        val body = lines.drop(start)
        val fence = body.indexOfFirst { it.trim() == "```" }
        val codeLines = if (fence > 0) body.subList(0, fence) else body
        return codeLines.joinToString("\n").trim()
    }
}
