package de.robocode

/**
 * Programmieren mit KI (P1). RoboCode bindet keine KI-API ein, sondern reicht
 * den Kontext per Teilen-Intent an eine KI-App weiter und holt die Antwort über
 * die Zwischenablage zurück.
 *
 * Ablauf: Der Stern-Knopf legt den Kontext in die Zwischenablage und öffnet die
 * (auf KI-Apps eingegrenzte) Teilen-Auswahl. Der Kontext erklärt RoboCode und
 * bittet die KI, das Verständnis mit „ja" zu bestätigen; die eigentliche Aufgabe
 * gibt der Nutzer danach in der KI-App (Sprache oder Text). Die KI antwortet mit
 * einem Codeblock, dessen erste Zeile die Anfrage-ID wiederholt. Beim Zurück­
 * kehren erkennt RoboCode die Antwort an dieser ID, ersetzt das Programm und
 * leert die Zwischenablage — ohne weiteren Dialog.
 *
 * Diese reine Logik (Prompt bauen, Antwort herausschneiden, App-Liste) lebt hier
 * ohne Android-Abhängigkeiten und bleibt damit testbar.
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
     * Bekannte KI-Chat-Apps (Paketnamen). Die Teilen-Auswahl wird auf die davon
     * installierten eingegrenzt. Unbekannte/falsche Namen schaden nicht — sie
     * tauchen nur nicht auf; ist keine installiert, bleibt die normale Auswahl.
     */
    val AI_PACKAGES = listOf(
        "com.openai.chatgpt",               // ChatGPT
        "com.anthropic.claude",             // Claude
        "com.google.android.apps.bard",     // Gemini
        "com.microsoft.copilot",            // Microsoft Copilot
        "ai.perplexity.app.android",        // Perplexity
        "com.deepseek.chat",                // DeepSeek
        "ai.x.grok",                        // Grok
        "com.google.android.googlequicksearchbox", // Google/Assistant (Gemini)
    )

    /**
     * Baut den Erklär-Prompt: RoboCode genau beschreiben, die vorhandenen
     * Board-Objekte und optional das aktuelle Programm mitgeben, und die KI um
     * eine „ja"-Bestätigung bitten. Die eigentliche Aufgabe folgt erst danach.
     */
    fun buildPrompt(id: String, boardContext: String, currentProgram: String?): String {
        val sb = StringBuilder()
        sb.append("Du bist ein Programmierhelfer für RoboCode. Mit RoboCode programmieren Kinder ")
        sb.append("einen Mikrocontroller (ESP32) direkt vom Handy aus.\n\n")

        sb.append("Was RoboCode ist:\n")
        sb.append("- RoboCode-Programme sind GÜLTIGER Python-Code (MicroPython auf dem ESP32). ")
        sb.append("Es ist keine eigene Sprache — nur eine kurze, handy-freundliche Schreibweise ")
        sb.append("(wenige Klammern, kurze Namen), damit man sie auf dem Handy leicht eintippen kann.\n")
        sb.append("- Du darfst ganz normales Python nutzen: Variablen, while True:, for, if/elif/else, ")
        sb.append("def, Rechnen, Vergleiche (and/or/not).\n\n")

        sb.append("Das Board-Objekt b ist bereits vorhanden — nutze NUR die unten genannten Objekte, ")
        sb.append("lege selbst keine Pins an und importiere nichts für die Pins:\n")
        sb.append("- Digitalausgang schalten (LED, Relais …): b.do0 = 1 (an) bzw. b.do0 = 0 (aus).\n")
        sb.append("- Digitaleingang lesen (Taster …): b.di0 — ergibt 0 oder 1.\n")
        sb.append("- Analogeingang lesen (Poti, Sensor …): b.a0 — ergibt eine Zahl.\n")
        sb.append("- Warten: wait(500) — Millisekunden. (Statt time.sleep.)\n")
        sb.append("- Wert an die Anzeige/Tafel im Handy senden: log(\"NAME:\" + str(wert)), ")
        sb.append("z. B. log(\"TEMP:\" + str(t)). Reiner Text geht auch: log(\"Hallo\").\n")
        sb.append("- Endlosprogramme laufen typischerweise in einer while True:-Schleife mit wait(...) darin.\n\n")

        sb.append("Vorhandene Board-Objekte dieses Projekts:\n").append(boardContext.trimEnd()).append("\n\n")

        if (!currentProgram.isNullOrBlank()) {
            sb.append("Aktuelles Programm (darf erweitert oder geändert werden):\n")
            sb.append("```python\n").append(currentProgram.trim()).append("\n```\n\n")
        }

        sb.append("Das war nur die Erklärung von RoboCode. Wenn du alles verstanden hast, ")
        sb.append("antworte NUR mit „ja\". Wenn etwas unklar ist, antworte mit „nein\" und frag nach.\n\n")
        sb.append("Danach gebe ich dir eine Aufgabe (per Sprache oder Text). Erstelle dann den Code ")
        sb.append("im Rahmen der RoboCode-Möglichkeiten und zeige ihn als EINEN kopierbaren Python-Codeblock ")
        sb.append("(damit man ihn mit einem Klick kopieren kann). Die ALLERERSTE Zeile des Codes muss ")
        sb.append("exakt dieser Kommentar sein:\n")
        sb.append(headerLine(id)).append("\n")
        return sb.toString()
    }

    /**
     * Schneidet aus einer Zwischenablage die Antwort zur Anfrage [id] heraus.
     *
     * - null, wenn die Zwischenablage unverändert der gesendete Prompt ist
     *   (Nutzer hat nichts kopiert) oder die Anfrage-ID-Kopfzeile fehlt (z. B. die
     *   reine „ja"-Bestätigung).
     * - sonst den Code ab der Kopfzeile bis zu einem evtl. folgenden ```-Zaun.
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
