package de.robocode

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.util.Log
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.hoho.android.usbserial.driver.UsbSerialDriver
import kotlin.concurrent.thread
import kotlin.math.max
import kotlin.math.min

/**
 * RoboCode — native Android-App (kein WebView).
 *
 * Vier Bereiche: Code (SETUP/MAIN/LIB + Start), Gerät (Verbinden/Installieren),
 * main.py (Vorschau) und Log. Beim Start versucht die App automatisch zu
 * verbinden: kein ESP32 -> Gerät-Tab + Hinweis; kein MicroPython -> Installation
 * vorschlagen; sonst direkt ins Code-Panel. Das Board wird beim Verbinden
 * automatisch erkannt (MicroPython os.uname bzw. ROM-Magic beim Flashen).
 */
class MainActivity : AppCompatActivity() {

    private lateinit var usb: UsbSerialLink

    private lateinit var editor: EditText
    private lateinit var palette: LinearLayout
    private lateinit var paletteSub: LinearLayout
    // Aufklapp-Zustand der Palette: offene Gruppe und (bei Board) gewählter Port.
    private var grp: String? = null
    private var grpPort: String? = null
    private lateinit var spinnerBoard: Spinner
    // Board-Ansicht (0.2)
    private lateinit var spinnerBoardCfg: Spinner
    private lateinit var boardRow: LinearLayout
    private lateinit var btnBoardClone: Button
    // Eigene Pin-Belegung (Board fürs Projekt geklont); null = Board-Standard.
    // Hinweis: noch nicht persistiert (Projektverwaltung 0.1 steht aus).
    private var projectPins: MutableList<PinDesc>? = null
    private var syncingBoard = false
    private lateinit var txtStatus: TextView
    private lateinit var txtDeviceInfo: TextView
    private lateinit var btnInstall: Button
    private lateinit var btnStart: ImageButton
    private lateinit var logView: TextView
    private lateinit var logScroll: ScrollView
    private lateinit var mainPyView: TextView
    private lateinit var terminalIn: TextView
    private lateinit var terminalInScroll: ScrollView
    private lateinit var terminalOut: EditText
    // Roadmap 1: grafische Tafel (Widgets über den LOG-Kanal) im Terminal-Panel.
    private lateinit var dashScroll: ScrollView
    private lateinit var dashBox: LinearLayout
    private lateinit var btnDashAdd: Button
    private lateinit var btnDashToggle: Button
    private lateinit var terminalOutRow: View

    private lateinit var panelCode: View
    private lateinit var panelBoard: View
    private lateinit var panelDevice: View
    private lateinit var panelMain: View
    private lateinit var panelTerminal: View
    private lateinit var panelLog: View

    // Läuft die Terminal-Leseschleife (Port bleibt offen, Programmausgabe wird gelesen)?
    @Volatile private var terminalRunning = false

    // Roadmap 1: Tafel des aktuellen Projekts. dashViews bildet LOG-Namen (GROSS)
    // auf die gespeisten Widget-Ansichten ab; ein Name darf mehrere speisen.
    private var dashboard: MutableList<Widget> = mutableListOf()
    private val dashViews = HashMap<String, MutableList<DashWidgetView>>()
    private var dashMode = false
    private val termLineBuf = StringBuilder()
    private val pairRe = Regex("([A-Za-z_][A-Za-z0-9_]*)\\s*:\\s*([^\\s,;]+)")

    private val tabs = linkedMapOf("setup" to seedSetup(), "main" to seedMain(), "lib" to seedLib())
    private var active = "setup"
    private var suppressWatcher = false
    private var editorLoaded = false

    // Projektverwaltung (0.1)
    private var currentId = ""
    private var currentName = "Mein Programm"
    private var projectsInfo: List<ProjectStore.Info> = emptyList()
    // Programmieren mit KI (P1): offene Anfrage + der genau so gesendete Prompt
    // (um die eigene Zwischenablage nicht als „Antwort" zu missdeuten).
    private var aiRequestId: String? = null
    private var aiSentPrompt: String? = null
    private var aiLastHandledClip: String? = null
    // Zuletzt angewandte Board-Position; verhindert, dass der anfängliche
    // Spinner-Callback eine gerade geladene Pin-Belegung verwirft.
    private var lastBoardIdx = -1

    @Volatile private var busy = false
    // Wenn per Intent-Extra ein Panel vorgegeben ist (z. B. für Screenshots),
    // soll Auto-Connect das Panel nicht umschalten.
    private var pinnedPanel: String? = null
    // Nicht abbrechbarer Dialog während des Flashens (blockiert alle Bedienung).
    private var flashDialog: AlertDialog? = null
    private var flashProgressView: TextView? = null
    private val actionUsbPermission get() = "$packageName.USB_PERMISSION"

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                actionUsbPermission -> {
                    val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                    log(if (granted) "USB-Berechtigung erteilt." else "USB-Berechtigung abgelehnt.")
                    if (granted) autoConnect()
                }
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> { log("ESP32 angesteckt."); autoConnect() }
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    log("ESP32 abgezogen.")
                    terminalRunning = false // Terminal-Leseschleife beenden
                    runOnUiThread { setStatus("● kein ESP32", RED); setStartEnabled(false) }
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.hide() // nur unsere kompakte Titelzeile zeigen
        setContentView(R.layout.activity_main)

        editor = findViewById(R.id.editor)
        palette = findViewById(R.id.palette)
        paletteSub = findViewById(R.id.paletteSub)
        spinnerBoard = findViewById(R.id.spinnerBoard)
        spinnerBoardCfg = findViewById(R.id.spinnerBoardCfg)
        boardRow = findViewById(R.id.boardRow)
        btnBoardClone = findViewById(R.id.btnBoardClone)
        txtStatus = findViewById(R.id.txtStatus)
        txtDeviceInfo = findViewById(R.id.txtDeviceInfo)
        btnInstall = findViewById(R.id.btnInstall)
        btnStart = findViewById(R.id.btnStart)
        logView = findViewById(R.id.log)
        logScroll = findViewById(R.id.logScroll)
        mainPyView = findViewById(R.id.mainPyView)
        terminalIn = findViewById(R.id.terminalIn)
        terminalInScroll = findViewById(R.id.terminalInScroll)
        terminalOut = findViewById(R.id.terminalOut)
        dashScroll = findViewById(R.id.dashScroll)
        dashBox = findViewById(R.id.dashBox)
        btnDashAdd = findViewById(R.id.btnDashAdd)
        btnDashToggle = findViewById(R.id.btnDashToggle)
        terminalOutRow = findViewById(R.id.terminalOutRow)
        panelCode = findViewById(R.id.panelCode)
        panelBoard = findViewById(R.id.panelBoard)
        panelDevice = findViewById(R.id.panelDevice)
        panelMain = findViewById(R.id.panelMain)
        panelTerminal = findViewById(R.id.panelTerminal)
        panelLog = findViewById(R.id.panelLog)

        usb = UsbSerialLink(this)
        val boardNames = Boards.ALL.map { it.name }
        spinnerBoard.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, boardNames)
        spinnerBoardCfg.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, boardNames)

        // Beide Board-Spinner (Gerät-Panel = Auto-Erkennung, Board-Panel = Konfig)
        // halten dieselbe Auswahl. Board-Wechsel verwirft die eigene Pin-Belegung.
        val onBoardPick = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                if (syncingBoard || pos == lastBoardIdx) return
                lastBoardIdx = pos
                syncingBoard = true
                spinnerBoard.setSelection(pos)
                spinnerBoardCfg.setSelection(pos)
                syncingBoard = false
                projectPins = null            // gehörte zum alten Board
                buildBoardPanel()
                saveCurrentProject()
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
        spinnerBoard.onItemSelectedListener = onBoardPick
        spinnerBoardCfg.onItemSelectedListener = onBoardPick

        // Top-Navigation
        findViewById<Button>(R.id.navCode).setOnClickListener { showPanel(panelCode) }
        findViewById<Button>(R.id.navBoard).setOnClickListener { buildBoardPanel(); showPanel(panelBoard) }
        findViewById<Button>(R.id.navDevice).setOnClickListener { showPanel(panelDevice) }
        btnBoardClone.setOnClickListener { if (projectPins == null) clonePins() else resetPins() }
        // Zuweisungs-Operator: fester Knopf rechts in der Leiste (nicht verschwindbar).
        findViewById<TextView>(R.id.btnAssign).setOnClickListener { insertAtCursor(" = ") }

        // Edit-Leiste unter dem Editor
        findViewById<TextView>(R.id.edTab).setOnClickListener { edInsertTab() }
        findViewById<TextView>(R.id.edBack).setOnClickListener { edBackspace() }
        findViewById<TextView>(R.id.edDelLine).setOnClickListener { edDeleteLine() }
        findViewById<TextView>(R.id.edUp).setOnClickListener { edLineMove(-1) }
        findViewById<TextView>(R.id.edDown).setOnClickListener { edLineMove(1) }

        // Projekt-Menü (Titelzeile)
        findViewById<TextView>(R.id.btnProject).setOnClickListener { saveCurrentProject(); showProjectDialog() }
        // Wortmarke = Startseite (Project Launcher) erneut öffnen.
        findViewById<TextView>(R.id.brand).setOnClickListener { saveCurrentProject(); showLauncher() }
        // Programmieren mit KI
        findViewById<TextView>(R.id.btnAi).setOnClickListener { showAiDialog() }
        findViewById<Button>(R.id.navMain).setOnClickListener { refreshMainPy(); showPanel(panelMain) }
        findViewById<Button>(R.id.navTerminal).setOnClickListener { showPanel(panelTerminal) }
        findViewById<Button>(R.id.navLog).setOnClickListener { showPanel(panelLog) }

        // Code-Sub-Tabs
        findViewById<Button>(R.id.tabSetup).setOnClickListener { switchTab("setup") }
        findViewById<Button>(R.id.tabMain).setOnClickListener { switchTab("main") }
        findViewById<Button>(R.id.tabLib).setOnClickListener { switchTab("lib") }

        // Aktionen
        btnStart.setOnClickListener { onStartClicked() }
        setStartEnabled(false)
        findViewById<Button>(R.id.btnConnect).setOnClickListener { autoConnect() }
        btnInstall.setOnClickListener { onInstall() }
        findViewById<Button>(R.id.btnCopyMain).setOnClickListener {
            refreshMainPy()
            (getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager)
                .setPrimaryClip(android.content.ClipData.newPlainText("main.py", assembleMainPy()))
            toast("main.py kopiert")
        }
        findViewById<Button>(R.id.btnDownloadMain).setOnClickListener { downloadMain() }
        findViewById<Button>(R.id.btnClearLog).setOnClickListener { logView.text = "" }
        findViewById<Button>(R.id.btnInfo).setOnClickListener { onInfo() }

        // Terminal (serielle Ein-/Ausgabe)
        findViewById<Button>(R.id.btnTerminalClear).setOnClickListener { terminalIn.text = "" }
        findViewById<Button>(R.id.btnTerminalStop).setOnClickListener { stopTerminal() }
        findViewById<Button>(R.id.btnTerminalSend).setOnClickListener { sendTerminalLine() }
        terminalOut.setOnEditorActionListener { _, _, _ -> sendTerminalLine(); true }
        // Tafel (Roadmap 1): Modus umschalten + Widget anlegen.
        btnDashToggle.setOnClickListener { setDashMode(!dashMode) }
        btnDashAdd.setOnClickListener { showWidgetDialog(null) }

        editor.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) { if (!suppressWatcher) tabs[active] = s?.toString() ?: "" }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })

        loadCurrentProject()   // lädt zuletzt genutztes Projekt; zeigt MAIN
        showPanel(panelCode)
        intent?.getStringExtra("panel")?.let { pinnedPanel = it; showPanelByName(it) }
        // Startseite: Projektliste statt direkt der Editor. Per Panel-Intent
        // (z. B. für Screenshots) wird sie übersprungen.
        if (pinnedPanel == null) showLauncher()

        val filter = IntentFilter(actionUsbPermission).apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        ContextCompat.registerReceiver(this, usbReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)

        log("RoboCode gestartet. Suche ESP32…")
        autoConnect()
    }

    // ---------------- Panels / Status ----------------

    private fun showPanel(p: View) {
        for (v in listOf(panelCode, panelBoard, panelDevice, panelMain, panelTerminal, panelLog))
            v.visibility = if (v === p) View.VISIBLE else View.GONE
    }

    private fun showPanelByName(name: String) = when (name) {
        "board" -> { buildBoardPanel(); showPanel(panelBoard) }
        "device" -> showPanel(panelDevice)
        "main" -> { refreshMainPy(); showPanel(panelMain) }
        "terminal" -> { setDashMode(false); showPanel(panelTerminal) }
        "tafel" -> { setDashMode(true); showPanel(panelTerminal); dashDemoFill() }
        "log" -> showPanel(panelLog)
        "info" -> { showPanel(panelDevice); onInfo() }
        else -> showPanel(panelCode)
    }

    private fun setStatus(text: String, color: Int) {
        txtStatus.text = text
        txtStatus.setTextColor(color)
    }

    // ---------------- Editor / Tabs / Palette ----------------

    private fun switchTab(key: String) {
        if (editorLoaded) tabs[active] = editor.text?.toString() ?: ""
        active = key
        suppressWatcher = true
        editor.setText(tabs[key])
        editor.setSelection(editor.text?.length ?: 0)
        suppressWatcher = false
        editorLoaded = true
        buildPalette(key)
    }

    // Palette als aufklappbare Gruppen. Top-Zeile = Gruppen (dieselben Icons wie
    // in der Web-App, als Vektor-Drawables). Klick klappt die Unter-Zeile auf;
    // Board hat eine dritte Stufe: do/di/a -> Zahl.
    private val GROUPS = listOf(
        "Board" to R.drawable.ic_chip,
        "Kontrolle" to R.drawable.ic_while,
        "Operator" to R.drawable.ic_gt,
        "Warte" to R.drawable.ic_wait,
        "Seriell" to R.drawable.ic_log,
        "Mehr" to R.drawable.ic_every,
    )

    private fun buildPalette(key: String) {
        grp = null; grpPort = null
        rebuildGroups()
    }

    /** Gruppen-Zeile zeichnen — markiert die offene Gruppe (grün), ohne den
     *  Zustand zurückzusetzen; danach die Unter-Zeile aktualisieren. */
    private fun rebuildGroups() {
        palette.removeAllViews()
        for ((g, icon) in GROUPS) {
            palette.addView(iconButton(icon, active = (g == grp)) {
                grp = if (grp == g) null else g
                grpPort = null
                rebuildGroups()
            })
        }
        refreshSub()
    }

    /** Baut die aufgeklappte Unter-Zeile anhand [grp]/[grpPort]. */
    private fun refreshSub() {
        paletteSub.removeAllViews()
        when (grp) {
            null -> { paletteSub.visibility = View.GONE; return }
            "Board" -> buildBoardSub()
            "Kontrolle" -> {
                iconLeaf(R.drawable.ic_while, "while True:")
                iconLeaf(R.drawable.ic_for, "for i in range(10):")
                iconLeaf(R.drawable.ic_if, "if :")
                iconLeaf(R.drawable.ic_elif, "elif :")
                iconLeaf(R.drawable.ic_else, "else:")
                iconLeaf(R.drawable.ic_def, "def name():")
            }
            "Operator" -> addChips(
                ">" to " > ", "<" to " < ", ">=" to " >= ", "<=" to " <= ", "==" to " == ",
                "=" to " = ", "+" to " + ", "-" to " - ", "und" to " and ", "oder" to " or ", "nicht" to "not ",
            )
            "Warte" -> buildWaitSub()
            "Seriell" -> {
                iconLeaf(R.drawable.ic_log, "log(\"Hallo\")")
                chip("log x") { insertAtCursor("log(\"Wert:\", )") }
            }
            "Mehr" -> {
                iconLeaf(R.drawable.ic_toggle, ".toggle()")
                iconLeaf(R.drawable.ic_color, ".color(\"rot\")")
                iconLeaf(R.drawable.ic_every, "takt = Every(300)")
            }
        }
        paletteSub.visibility = View.VISIBLE
    }

    private fun buildBoardSub() {
        val bk = selectedBoard().banks
        if (grpPort == null) {
            // do/di/a: kleine 1/0 bzw. ~ oben, Pfeil zeigt die Richtung (raus/rein).
            paletteSub.addView(portButton("1/0", R.drawable.ic_arrow_out) { grpPort = "do"; refreshSub() })
            paletteSub.addView(portButton("1/0", R.drawable.ic_arrow_in) { grpPort = "di"; refreshSub() })
            paletteSub.addView(portButton("~", R.drawable.ic_arrow_in) { grpPort = "a"; refreshSub() })
            // Eigene (umbenannte) Pins aus der Board-Ansicht als Chips.
            for (np in namedPins()) chip(np.name) { insertAtCursor(np.name) }
        } else {
            chip("‹") { grpPort = null; refreshSub() }
            val count = when (grpPort) { "do" -> bk.doPins.size; "di" -> bk.diPins.size; else -> bk.aPins.size }
            for (n in 0 until count) {
                val insert = if (grpPort == "do") "b.do$n = 1" else "b.$grpPort$n"
                chip("$n") { insertAtCursor(insert); grpPort = null; refreshSub() }
            }
        }
    }

    private fun buildWaitSub() {
        for (ms in listOf(100, 250, 500, 1000, 2000)) chip("$ms") { insertAtCursor("wait($ms)") }
        // Schieberegler als Eingabe
        val label = TextView(this).apply {
            text = "wait(500)"; setPadding(dp(10), 0, dp(6), 0); setTextColor(ICON)
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val seek = SeekBar(this).apply {
            max = 2000; progress = 500
            layoutParams = LinearLayout.LayoutParams(dp(150), LinearLayout.LayoutParams.WRAP_CONTENT)
            // Drag im horizontalen ScrollView zulassen
            setOnTouchListener { v, _ -> v.parent?.requestDisallowInterceptTouchEvent(true); false }
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(sb: SeekBar, p: Int, u: Boolean) { label.text = "wait($p)" }
                override fun onStartTrackingTouch(sb: SeekBar) {}
                override fun onStopTrackingTouch(sb: SeekBar) {}
            })
        }
        paletteSub.addView(label)
        paletteSub.addView(seek)
        chip("einfügen") { insertAtCursor("wait(${seek.progress})") }
    }

    // ---- Palette-Bausteine (schmal, mit Rahmen; grün wenn aktiv) ----

    private fun iconButtonBg(active: Boolean): android.graphics.drawable.GradientDrawable =
        android.graphics.drawable.GradientDrawable().apply {
            cornerRadius = dp(6).toFloat()
            setColor(if (active) 0xFFE6FBF6.toInt() else 0xFFFFFFFF.toInt())
            setStroke(dp(1), if (active) GREEN else 0xFFCBD5E1.toInt())
        }

    /** Nur-Icon-Button (Gruppen & Befehle). */
    private fun iconButton(iconRes: Int, active: Boolean, onClick: () -> Unit): ImageButton =
        ImageButton(this).apply {
            setImageResource(iconRes)
            background = iconButtonBg(active)
            setColorFilter(if (active) GREEN else ICON)
            scaleType = ImageView.ScaleType.FIT_CENTER
            adjustViewBounds = true
            minimumWidth = 0
            setPadding(dp(7), dp(4), dp(7), dp(4))
            layoutParams = LinearLayout.LayoutParams(dp(34), dp(30)).apply { marginEnd = dp(4) }
            setOnClickListener { onClick() }
        }

    /** Port-Button: kleine Zahl/Welle oben über dem Richtungspfeil. */
    private fun portButton(top: String, arrowRes: Int, onClick: () -> Unit): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER_HORIZONTAL
            background = iconButtonBg(false)
            setPadding(dp(8), dp(2), dp(8), dp(2))
            isClickable = true
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(34))
                .apply { marginEnd = dp(4) }
            addView(TextView(this@MainActivity).apply {
                text = top; textSize = 8f; setTextColor(ICON)
                includeFontPadding = false; gravity = android.view.Gravity.CENTER
            })
            addView(ImageView(this@MainActivity).apply {
                setImageResource(arrowRes); setColorFilter(ICON)
                scaleType = ImageView.ScaleType.FIT_CENTER
                layoutParams = LinearLayout.LayoutParams(dp(20), dp(13))
            })
            setOnClickListener { onClick() }
        }

    private fun iconLeaf(iconRes: Int, insert: String) {
        paletteSub.addView(iconButton(iconRes, active = false) { insertAtCursor(insert) })
    }

    private fun addChips(vararg items: Pair<String, String>) {
        for ((label, text) in items) chip(label) { insertAtCursor(text) }
    }

    /** Text-Chip im gleichen schmalen Rahmen (Operatoren, Zahlen, Wörter). */
    private fun chip(label: String, onClick: () -> Unit): TextView =
        TextView(this).apply {
            text = label; textSize = 13f; setTextColor(ICON)
            background = iconButtonBg(false)
            setPadding(dp(8), dp(4), dp(8), dp(4))
            gravity = android.view.Gravity.CENTER
            isClickable = true
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(30))
                .apply { marginEnd = dp(4); gravity = android.view.Gravity.CENTER_VERTICAL }
            setOnClickListener { onClick() }
        }.also { paletteSub.addView(it) }

    /** Start-Dreieck (links in der Werkzeugzeile): grün aktiv, grau/gedimmt aus. */
    private fun setStartEnabled(on: Boolean) {
        btnStart.isEnabled = on
        btnStart.setColorFilter(if (on) GREEN else GRAY)
        btnStart.alpha = if (on) 1f else 0.45f
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun insertAtCursor(text: String) {
        var t = text
        if (t.trimEnd().endsWith(":")) t += "\n    "
        val s = max(editor.selectionStart, 0)
        val e = max(editor.selectionEnd, 0)
        editor.text.replace(min(s, e), max(s, e), t)
    }

    // ---- Edit-Leiste: Tab/Backspace/Zeile löschen/Zeilen-Navigation ----

    private val tabWidth = 4

    private fun edInsertTab() {
        val s = max(editor.selectionStart, 0); val e = max(editor.selectionEnd, 0)
        editor.text.replace(min(s, e), max(s, e), " ".repeat(tabWidth))
    }

    /** Backspace: Auswahl löschen; sonst ein Zeichen — bei Leerzeichen links aber
     *  bis zu [tabWidth] am Stück (wie ein Tab zurück). */
    private fun edBackspace() {
        val s = editor.selectionStart; val e = editor.selectionEnd
        if (s < 0) return
        if (s != e) { editor.text.delete(min(s, e), max(s, e)); return }
        if (s == 0) return
        val t = editor.text
        var n = 0
        while (s - 1 - n >= 0 && t[s - 1 - n] == ' ' && n < tabWidth) n++
        editor.text.delete(s - (if (n > 0) n else 1), s)
    }

    /** Aktuelle Zeile samt Zeilenumbruch löschen. */
    private fun edDeleteLine() {
        val t = editor.text; val pos = max(editor.selectionStart, 0)
        var start = pos; while (start > 0 && t[start - 1] != '\n') start--
        var end = pos; while (end < t.length && t[end] != '\n') end++
        if (end < t.length) end++ else if (start > 0) start--  // Umbruch mitnehmen
        editor.text.delete(start, end)
    }

    /** Cursor eine Zeile hoch (dir=-1) / runter (dir=+1), Spalte beibehalten. */
    private fun edLineMove(dir: Int) {
        val layout = editor.layout ?: return
        val pos = max(editor.selectionStart, 0)
        val target = layout.getLineForOffset(pos) + dir
        if (target < 0 || target >= layout.lineCount) return
        val x = layout.getPrimaryHorizontal(pos)
        editor.setSelection(layout.getOffsetForHorizontal(target, x).coerceIn(0, editor.text.length))
    }

    private fun selectedBoard(): Board = Boards.ALL[max(spinnerBoard.selectedItemPosition, 0)]

    private fun setBoard(id: String) {
        val idx = Boards.ALL.indexOfFirst { it.id == id }
        if (idx >= 0) runOnUiThread { spinnerBoard.setSelection(idx) }
    }

    private fun boardIdFrom(info: String?): String? = when {
        info == null -> null
        info.contains("C3", true) -> "esp32c3"
        info.contains("S3", true) -> "esp32s3"
        else -> null
    }

    // ---------------- Board-Ansicht (0.2 — Pin-Belegung) ----------------

    private val clonedPins get() = projectPins != null
    private fun effectivePins(): List<PinDesc> = projectPins ?: selectedBoard().defaultPins()

    private fun clonePins() { projectPins = selectedBoard().defaultPins().toMutableList(); buildBoardPanel(); saveCurrentProject() }
    private fun resetPins() { projectPins = null; buildBoardPanel(); saveCurrentProject() }

    /** Eigene (umbenannte) Pins mit nutzbarer Rolle → als Chips in der Palette. */
    private fun namedPins(): List<PinDesc> = effectivePins().filter {
        Boards.isValidName(it.name) && it.role != PinRole.NONE &&
            !Regex("^(A|DI|DO|GPIO)\\d+$").matches(it.name)
    }

    /** Baut die Board-Ansicht: linke Pins | Board-Bild | rechte Pins. Die Reihen
     *  werden über die Bildhöhe verteilt (weight=1), damit sie auf Höhe der
     *  realen Pins liegen (wie im Web). */
    private fun buildBoardPanel() {
        if (!::boardRow.isInitialized) return
        // Spinner-Auswahl ohne erneuten Listener-Durchlauf angleichen.
        val idx = max(spinnerBoard.selectedItemPosition, 0)
        if (spinnerBoardCfg.selectedItemPosition != idx) {
            syncingBoard = true; spinnerBoardCfg.setSelection(idx); syncingBoard = false
        }
        val board = selectedBoard()
        btnBoardClone.text = if (clonedPins) "Standard" else "Klonen"

        boardRow.removeAllViews()
        val byGpio = effectivePins().associateBy { it.gpio }
        val colH = dp(420)   // Platz für bis zu 9 Reihen (S3) ohne Gedränge
        boardRow.addView(buildPinColumn(board.layout.left, "l", byGpio, colH))
        boardRow.addView(buildBoardImage(board, colH))
        boardRow.addView(buildPinColumn(board.layout.right, "r", byGpio, colH))
    }

    private fun buildBoardImage(board: Board, colH: Int): View {
        val iv = ImageView(this).apply {
            adjustViewBounds = true
            maxHeight = colH
            scaleType = ImageView.ScaleType.FIT_CENTER
            layoutParams = LinearLayout.LayoutParams(dp(140), colH).apply { marginStart = dp(1); marginEnd = dp(1) }
        }
        val bmp = board.image?.let { path ->
            try { assets.open(path).use { BitmapFactory.decodeStream(it) } } catch (_: Exception) { null }
        }
        if (bmp != null) iv.setImageBitmap(bmp) else iv.setImageResource(R.drawable.ic_chip)
        return iv
    }

    private fun buildPinColumn(slots: List<Slot>, side: String, byGpio: Map<Int, PinDesc>, colH: Int): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (colH * 0.06f).toInt()
            setPadding(0, pad, 0, pad)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, colH)
            for (slot in slots) addView(
                buildSlotRow(slot, side, byGpio),
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, 0, 1f),
            )
        }

    private fun buildSlotRow(slot: Slot, side: String, byGpio: Map<Int, PinDesc>): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val children = ArrayList<View>()
        if (slot.power != null) {
            children.add(powerChip(slot.power))
            children.add(spacerView(dp(42)))
        } else {
            val p = byGpio[slot.gpio] ?: return row
            if (p.role in PinRole.RESERVED) {
                children.add(reservedChip(p)); children.add(roleBadge(p.role))
            } else {
                children.add(nameField(p)); children.add(roleSpinner(p))
            }
        }
        // `side == "l"`: Reihenfolge drehen, damit Name/Rolle zur Platine passen.
        for (v in if (side == "l") children.reversed() else children) row.addView(v)
        return row
    }

    private fun chipBg(fill: Int, stroke: Int) = android.graphics.drawable.GradientDrawable().apply {
        cornerRadius = dp(4).toFloat(); setColor(fill); setStroke(dp(1), stroke)
    }

    private fun powerChip(power: String): TextView = TextView(this).apply {
        text = power; textSize = 11f
        typeface = android.graphics.Typeface.MONOSPACE
        gravity = android.view.Gravity.CENTER
        val dark = power == "GND"
        setTextColor(if (dark) 0xFFFFFFFF.toInt() else 0xFFB91C1C.toInt())
        background = chipBg(if (dark) 0xFF374151.toInt() else 0xFFFEE2E2.toInt(), if (dark) 0xFF374151.toInt() else 0xFFFCA5A5.toInt())
        layoutParams = LinearLayout.LayoutParams(dp(42), dp(26))
    }

    private fun reservedChip(p: PinDesc): TextView = TextView(this).apply {
        text = p.name; textSize = 11f
        typeface = android.graphics.Typeface.MONOSPACE
        gravity = android.view.Gravity.CENTER
        setTextColor(0xFFB45309.toInt())
        background = chipBg(0xFFFFFBEB.toInt(), 0xFFFCD34D.toInt())
        layoutParams = LinearLayout.LayoutParams(dp(42), dp(26))
    }

    private fun roleBadge(role: PinRole): TextView = TextView(this).apply {
        text = role.code; textSize = 10f; setTextColor(0xFFB45309.toInt())
        typeface = android.graphics.Typeface.MONOSPACE
        gravity = android.view.Gravity.CENTER
        layoutParams = LinearLayout.LayoutParams(dp(42), LinearLayout.LayoutParams.WRAP_CONTENT)
    }

    private fun nameField(p: PinDesc): EditText = EditText(this).apply {
        setText(p.name); textSize = 11f
        typeface = android.graphics.Typeface.MONOSPACE
        isEnabled = clonedPins
        setSingleLine(true)
        minHeight = 0; minimumHeight = dp(26)
        setPadding(dp(3), dp(2), dp(3), dp(2))
        inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        layoutParams = LinearLayout.LayoutParams(dp(42), LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(1) }
        fun refreshBorder() = run {
            background = chipBg(if (clonedPins) 0xFFFFFFFF.toInt() else 0xFFF9FAFB.toInt(),
                if (Boards.isValidName(text.toString())) 0xFFD1D5DB.toInt() else 0xFFF87171.toInt())
        }
        refreshBorder()
        addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) { p.name = s?.toString() ?: ""; refreshBorder() }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })
    }

    private fun roleSpinner(p: PinDesc): Spinner {
        val roles = PinRole.EDITABLE.filter { it != PinRole.A || p.adc }
        return Spinner(this).apply {
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, roles.map { it.code })
            setSelection(roles.indexOf(p.role).coerceAtLeast(0))
            isEnabled = clonedPins
            minimumWidth = 0
            setPadding(0, 0, 0, 0)
            layoutParams = LinearLayout.LayoutParams(dp(42), LinearLayout.LayoutParams.WRAP_CONTENT)
            onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: AdapterView<*>?, v: View?, pos: Int, id: Long) { p.role = roles[pos] }
                override fun onNothingSelected(parent: AdapterView<*>?) {}
            }
        }
    }

    private fun spacerView(w: Int): View = View(this).apply { layoutParams = LinearLayout.LayoutParams(w, dp(1)) }

    // ---------------- Auto-Connect / Erkennung ----------------

    private fun autoConnect() {
        if (busy) return
        val driver = usb.findDriver()
        if (driver == null) {
            runOnUiThread {
                setStatus("● kein ESP32", RED)
                txtDeviceInfo.text = "Kein ESP32 erkannt.\nBitte ESP32 per USB-OTG anschließen."
                if (pinnedPanel == null) showPanel(panelDevice)
            }
            log("Kein ESP32 erkannt — bitte anschließen.")
            return
        }
        if (!usb.hasPermission(driver.device)) {
            runOnUiThread { setStatus("● Berechtigung…", GRAY); showPanel(panelDevice) }
            requestUsbPermission(driver.device)
            return
        }
        runBusy { doDetect(driver) }
    }

    private fun doDetect(driver: UsbSerialDriver) {
        runOnUiThread { setStatus("● prüfe…", GRAY) }
        if (!usb.open(driver, 115200, assertControlLines = false)) { log("Port öffnen fehlgeschlagen."); return }
        try {
            val repl = MicroPythonRepl(usb)
            log("Prüfe auf MicroPython…")
            if (repl.isMicroPython()) {
                val m = repl.machine()
                boardIdFrom(m)?.let { setBoard(it) }
                log("✓ MicroPython erkannt${if (m != null) " ($m)" else ""}.")
                runOnUiThread {
                    setStatus("● verbunden · ${selectedBoard().name}", GREEN)
                    setStartEnabled(true); btnInstall.isEnabled = false
                    txtDeviceInfo.text = "Verbunden. MicroPython läuft.\nBoard: ${selectedBoard().name}" +
                        (if (m != null) "\n$m" else "")
                    if (pinnedPanel == null) showPanel(panelCode)
                }
            } else {
                log("ESP32 ohne MicroPython.")
                runOnUiThread {
                    setStatus("● ohne MicroPython", ORANGE)
                    setStartEnabled(false); btnInstall.isEnabled = true
                    txtDeviceInfo.text = "ESP32 erkannt, aber kein MicroPython.\n→ »MicroPython installieren«."
                    if (pinnedPanel == null) showPanel(panelDevice)
                }
            }
        } finally {
            usb.close()
        }
    }

    // ---------------- MicroPython installieren (flashen) ----------------

    private fun onInstall() {
        if (busy) { toast("Läuft bereits…"); return }
        val driver = usb.findDriver() ?: run { toast("Kein ESP32 erkannt"); return }
        if (!ensurePermission(driver.device)) return
        showBootDialog { runBusy { doFlash(driver) } }
    }

    private fun doFlash(driver: UsbSerialDriver) {
        val listener = object : EspLoader.Listener {
            override fun log(msg: String) = this@MainActivity.log(msg)
            override fun progress(doneBytes: Int, totalBytes: Int) {
                // Kein Byte-Spam ins Log — nur den Prozent-Stand im Warn-Dialog.
                val pct = if (totalBytes > 0) doneBytes * 100 / totalBytes else 0
                runOnUiThread { flashProgressView?.text = "läuft… $pct %" }
            }
        }
        // Flashen: Steuerleitungen anlegen (Board im Download-Modus).
        if (!usb.open(driver, 115200, assertControlLines = true)) { log("Port öffnen fehlgeschlagen."); return }
        try {
            runOnUiThread { setStatus("● flashe…", GRAY); showFlashDialog() }
            log("Synchronisiere mit ROM-Bootloader…")
            val loader = EspLoader(usb)
            if (!loader.connect(listener)) { log("Keine Antwort. Board im Download-Modus?"); return }
            // Board aus dem erkannten Chip wählen.
            boardIdFrom(loader.chipInfo)?.let { setBoard(it) }
            val board = boardIdFrom(loader.chipInfo)?.let { Boards.byId(it) } ?: selectedBoard()
            val img = loadFirmwareAsset(board.firmwareAsset) ?: run {
                log("Firmware fehlt: assets/firmware/${board.firmwareAsset}"); return
            }
            log("Flashe ${board.name} (${img.size} Byte)…")
            val ok = loader.flash(img, board.flashOffset, listener)
            if (ok) {
                log("✓ MicroPython installiert. Prüfe erneut…")
                runOnUiThread { setStatus("● installiert", ORANGE) }
            } else log("✗ Flashen fehlgeschlagen.")
        } catch (e: Exception) {
            log("Fehler: ${e.message}")
        } finally {
            usb.close()
            runOnUiThread { dismissFlashDialog() }
        }
        // Nach dem Reboot neu erkennen (Gerät re-enumeriert; kurz warten).
        try { Thread.sleep(1500) } catch (_: InterruptedException) {}
        autoConnect()
    }

    /** Nicht abbrechbarer Hinweis während des Flashens: alle anderen Bedienelemente
     *  sind dadurch gesperrt; deutliche Warnung, nicht zu unterbrechen. */
    private fun showFlashDialog() {
        if (flashDialog?.isShowing == true) return
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(18), dp(22), dp(10))
        }
        box.addView(TextView(this).apply {
            text = "⚠ MicroPython wird installiert.\n\nBitte NICHT abbrechen, das Gerät nicht trennen und die App nicht schließen, bis es fertig ist."
            textSize = 14f; setTextColor(ORANGE)
        })
        val prog = TextView(this).apply {
            text = "läuft…"; textSize = 12f; setTextColor(ICON); setPadding(0, dp(14), 0, 0)
        }
        box.addView(prog)
        flashProgressView = prog
        flashDialog = AlertDialog.Builder(this)
            .setTitle("Installation läuft").setView(box).setCancelable(false).create()
        flashDialog?.setCanceledOnTouchOutside(false)
        flashDialog?.show()
    }

    private fun dismissFlashDialog() {
        flashDialog?.dismiss(); flashDialog = null; flashProgressView = null
    }

    // ---------------- Start: zusammenbauen, übertragen, ausführen ----------------

    private fun onStartClicked() {
        if (busy) { toast("Läuft bereits…"); return }
        tabs[active] = editor.text?.toString() ?: ""
        val driver = usb.findDriver() ?: run { toast("Kein ESP32 erkannt"); return }
        if (!ensurePermission(driver.device)) return
        runBusy { doStart(driver) }
    }

    private fun doStart(driver: UsbSerialDriver) {
        val mainPy = assembleMainPy()
        if (!usb.open(driver, 115200, assertControlLines = false)) { log("Port öffnen fehlgeschlagen."); return }
        try {
            val repl = MicroPythonRepl(usb)
            if (!repl.isMicroPython()) { log("Kein MicroPython — erst installieren."); return }
            val listener = object : MicroPythonRepl.Listener {
                override fun log(msg: String) = this@MainActivity.log(msg)
            }
            log("Übertrage main.py (${mainPy.length} Zeichen)…")
            if (!repl.uploadMain(mainPy, listener)) { log("Übertragung fehlgeschlagen."); return }
            log("Starte (Soft-Reset)…")
            repl.softReset()
            log("Läuft. Ausgabe im Terminal. (main.py startet nun auch bei jedem Boot.)")
            runTerminalLoop()
        } catch (e: Exception) {
            log("Fehler: ${e.message}")
        } finally {
            usb.close()
        }
    }

    // ---------------- Terminal: serielle Ein-/Ausgabe ----------------

    /**
     * Hält den Port offen und liest die Programmausgabe (print/log) fortlaufend
     * ins Terminal — bis »Stop« gedrückt oder das Gerät getrennt wird. Läuft im
     * runBusy-Thread von [doStart]; das `finally` dort schließt danach den Port.
     */
    private fun runTerminalLoop() {
        terminalRunning = true
        runOnUiThread {
            setStatus("● läuft · ${selectedBoard().name}", GREEN)
            appendTerminal("— verbunden, Programm läuft —\n")
            if (pinnedPanel == null) showPanel(panelTerminal)
        }
        val buf = ByteArray(1024)
        while (terminalRunning && usb.isOpen) {
            val n = usb.readRaw(buf, 200)
            if (n > 0) appendTerminal(String(buf, 0, n, Charsets.UTF_8))
        }
        runOnUiThread {
            appendTerminal("\n— Terminal beendet —\n")
            setStatus("● verbunden · ${selectedBoard().name}", GREEN)
        }
    }

    private fun stopTerminal() {
        if (!terminalRunning) { toast("Terminal läuft nicht"); return }
        terminalRunning = false
        log("Terminal gestoppt.")
    }

    /** Eine Zeile an den ESP32 senden (wie Arduino-SerMonitor: Text + CR/LF). */
    private fun sendTerminalLine() {
        val line = terminalOut.text?.toString() ?: ""
        if (line.isEmpty()) return
        if (!usb.isOpen || !terminalRunning) { toast("Nicht verbunden — erst Start"); return }
        thread(isDaemon = true) { usb.writeRaw((line + "\r\n").toByteArray(Charsets.UTF_8)) }
        appendTerminal("» $line\n")
        terminalOut.setText("")
    }

    private fun appendTerminal(s: String) {
        runOnUiThread {
            terminalIn.append(s)
            terminalInScroll.post { terminalInScroll.fullScroll(ScrollView.FOCUS_DOWN) }
            feedDashboard(s)
        }
    }

    // ---------------- Tafel (Roadmap 1): LOG-Kanal → Widgets ----------------

    /**
     * Füttert die Tafel aus dem seriellen Textstrom. Zeilen können über mehrere
     * Lese-Chunks zerteilt ankommen, darum ein Zeilenpuffer. Nur vollständige
     * Zeilen werden geparst; erkannte `NAME:wert`-Paare speisen passende Widgets.
     * Alles bleibt zusätzlich im Text-Terminal sichtbar (unbekannte Namen sowieso).
     */
    private fun feedDashboard(chunk: String) {
        if (dashViews.isEmpty()) return
        termLineBuf.append(chunk)
        var nl = termLineBuf.indexOf("\n")
        while (nl >= 0) {
            dispatchLine(termLineBuf.substring(0, nl))
            termLineBuf.delete(0, nl + 1)
            nl = termLineBuf.indexOf("\n")
        }
        if (termLineBuf.length > 4096) termLineBuf.setLength(0) // Schutz gegen Dauerzeile ohne \n
    }

    private fun dispatchLine(line: String) {
        for (m in pairRe.findAll(line)) {
            val views = dashViews[m.groupValues[1].uppercase()] ?: continue
            val raw = m.groupValues[2]
            val num = raw.toDoubleOrNull()
            for (v in views) v.feed(raw, num)
        }
    }

    /**
     * Nur-Screenshot-Hilfe: füllt die Tafel mit Beispielwerten, damit sie ohne
     * echten ESP32 belegt aussieht. Erreichbar ausschließlich über das adb-Intent-
     * Extra `panel=tafel` (im normalen UI nie), speichert nichts. Hat das Projekt
     * keine Widgets, werden flüchtige Demo-Widgets gezeigt.
     */
    private fun dashDemoFill() {
        if (pinnedPanel != "tafel") return
        if (dashboard.isEmpty()) { dashboard = seedDashboard(); rebuildDashViews() }
        for ((key, views) in dashViews) {
            val sample = when (key) { "TEMP" -> "27"; "DIST" -> "63"; "LED" -> "1"; else -> "42" }
            for (v in views) { for (x in listOf("5", "40", sample)) v.feed(x, x.toDoubleOrNull()) }
        }
    }

    /** Tafel ⇄ Text umschalten (gleicher Datenstrom, andere Darstellung). */
    private fun setDashMode(on: Boolean) {
        dashMode = on
        terminalInScroll.visibility = if (on) View.GONE else View.VISIBLE
        terminalOutRow.visibility = if (on) View.GONE else View.VISIBLE
        dashScroll.visibility = if (on) View.VISIBLE else View.GONE
        btnDashAdd.visibility = if (on) View.VISIBLE else View.GONE
        btnDashToggle.text = if (on) "Text" else "Tafel"
    }

    /** Tafel-Ansichten aus [dashboard] neu aufbauen und nach LOG-Namen indizieren. */
    private fun rebuildDashViews() {
        dashBox.removeAllViews()
        dashViews.clear()
        if (dashboard.isEmpty()) {
            dashBox.addView(TextView(this).apply {
                text = "Noch keine Anzeige. „+ Widget“ tippen.\n" +
                    "Im Programm sende z. B.  log(\"TEMP:\" + str(wert))"
                setTextColor(GRAY); textSize = 12f; setPadding(dp(14), dp(16), dp(14), dp(16))
            })
            return
        }
        for (w in dashboard) {
            val view = DashWidgetView(this, w).apply {
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                setOnClickListener { showWidgetDialog(w) }
            }
            dashBox.addView(view)
            dashViews.getOrPut(w.name.uppercase()) { mutableListOf() }.add(view)
        }
    }

    /** Widget anlegen oder bearbeiten (Typ, LOG-Name, Bereich); existierend löschbar. */
    private fun showWidgetDialog(existing: Widget?) {
        val ctx = this
        val root = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(10), dp(18), dp(4)) }

        root.addView(TextView(ctx).apply { text = "Typ"; textSize = 11f; setTextColor(GRAY) })
        val typeSpinner = Spinner(ctx).apply {
            adapter = ArrayAdapter(ctx, android.R.layout.simple_spinner_dropdown_item, WidgetType.entries.map { it.label })
            setSelection(WidgetType.entries.indexOf(existing?.type ?: WidgetType.GAU))
        }
        root.addView(typeSpinner)

        root.addView(TextView(ctx).apply { text = "LOG-Name (z. B. DIST)"; textSize = 11f; setTextColor(GRAY); setPadding(0, dp(8), 0, 0) })
        val nameEdit = EditText(ctx).apply { setText(existing?.name ?: ""); setSingleLine(true); hint = "DIST" }
        root.addView(nameEdit)

        val rangeRow = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(8), 0, 0) }
        val minEdit = EditText(ctx).apply {
            setText((existing?.min ?: 0.0).let { if (it == it.toLong().toDouble()) it.toLong().toString() else it.toString() })
            hint = "min"; inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_SIGNED or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val maxEdit = EditText(ctx).apply {
            setText((existing?.max ?: 100.0).let { if (it == it.toLong().toDouble()) it.toLong().toString() else it.toString() })
            hint = "max"; inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_SIGNED or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val rangeLabel = TextView(ctx).apply { text = "Bereich"; textSize = 11f; setTextColor(GRAY); setPadding(0, dp(8), 0, 0) }
        rangeRow.addView(minEdit); rangeRow.addView(maxEdit)
        root.addView(rangeLabel); root.addView(rangeRow)

        // Bereich nur für Zeiger/Balken sinnvoll.
        fun syncRange() {
            val needs = typeSpinner.selectedItemPosition.let { WidgetType.entries[it] } in listOf(WidgetType.GAU, WidgetType.BAR)
            rangeLabel.visibility = if (needs) View.VISIBLE else View.GONE
            rangeRow.visibility = if (needs) View.VISIBLE else View.GONE
        }
        typeSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) = syncRange()
            override fun onNothingSelected(p: AdapterView<*>?) {}
        }
        syncRange()

        val builder = AlertDialog.Builder(ctx)
            .setTitle(if (existing == null) "Widget anlegen" else "Widget bearbeiten")
            .setView(ScrollView(ctx).apply { addView(root) })
            .setPositiveButton("Speichern") { _, _ ->
                val name = nameEdit.text?.toString()?.trim().orEmpty()
                if (name.isEmpty()) { toast("LOG-Name fehlt"); return@setPositiveButton }
                val type = WidgetType.entries[typeSpinner.selectedItemPosition]
                val mn = minEdit.text?.toString()?.toDoubleOrNull() ?: 0.0
                val mx = maxEdit.text?.toString()?.toDoubleOrNull() ?: 100.0
                if (existing == null) {
                    dashboard.add(Widget(newWidgetId(), type, name, mn, mx))
                } else {
                    existing.type = type; existing.name = name; existing.min = mn; existing.max = mx
                }
                rebuildDashViews(); saveCurrentProject()
            }
            .setNegativeButton("Abbrechen", null)
        if (existing != null) builder.setNeutralButton("Löschen") { _, _ ->
            dashboard.remove(existing); rebuildDashViews(); saveCurrentProject()
        }
        builder.show()
    }

    private fun assembleMainPy(): String {
        val robopy = try {
            assets.open("dsl/robopy.py").use { String(it.readBytes(), Charsets.UTF_8) }
        } catch (e: Exception) { log("DSL-Asset fehlt: ${e.message}"); "" }
        return Assembler.assemble(
            Assembler.Parts(tabs["setup"] ?: "", tabs["lib"] ?: "", tabs["main"] ?: ""),
            selectedBoard(), robopy, projectPins,
        )
    }

    private fun refreshMainPy() {
        tabs[active] = editor.text?.toString() ?: ""
        mainPyView.text = assembleMainPy()
    }

    private fun downloadMain() {
        try {
            val dir = getExternalFilesDir(null)
            val f = java.io.File(dir, "main.py")
            f.writeText(assembleMainPy())
            log("main.py gespeichert: ${f.absolutePath}")
            toast("gespeichert: ${f.absolutePath}")
        } catch (e: Exception) { log("Speichern fehlgeschlagen: ${e.message}") }
    }

    // ---------------- Info & Lizenzen ----------------

    private fun onInfo() {
        val mpy = try {
            assets.open("licenses/micropython-LICENSE.txt").use { String(it.readBytes(), Charsets.UTF_8) }
        } catch (e: Exception) { "(MicroPython-Lizenz nicht gefunden: ${e.message})" }
        val text = buildString {
            append("RoboCode — mobile MicroPython-IDE für ESP32.\n\n")
            append("Verwendete Drittkomponenten:\n\n")
            append("• MicroPython (als Firmware eingebettet) — MIT-Lizenz, micropython.org\n")
            append("• usb-serial-for-android (USB-CDC) — MIT-Lizenz, github.com/mik3y/usb-serial-for-android\n\n")
            append("────────────────────────────────────\n")
            append("MicroPython — Lizenz (v1.29.0):\n\n")
            append(mpy)
        }
        val scroll = ScrollView(this)
        scroll.addView(TextView(this).apply {
            this.text = text
            textSize = 11f
            setTextIsSelectable(true)
            typeface = android.graphics.Typeface.MONOSPACE
            setPadding(24, 24, 24, 24)
        })
        AlertDialog.Builder(this).setTitle("Info & Lizenzen").setView(scroll)
            .setPositiveButton("Schließen", null).show()
    }

    // ---------------- USB-Berechtigung / Hilfen ----------------

    private fun ensurePermission(device: UsbDevice): Boolean {
        if (usb.hasPermission(device)) return true
        requestUsbPermission(device)
        log("USB-Berechtigung angefragt — nach Bestätigung erneut.")
        return false
    }

    private fun requestUsbPermission(device: UsbDevice) {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        val pi = PendingIntent.getBroadcast(this, 0, Intent(actionUsbPermission).setPackage(packageName), flags)
        (getSystemService(Context.USB_SERVICE) as UsbManager).requestPermission(device, pi)
    }

    private fun loadFirmwareAsset(name: String): ByteArray? = try {
        assets.open("firmware/$name").use { it.readBytes() }
    } catch (_: Exception) { null }

    private fun showBootDialog(onProceed: () -> Unit) {
        AlertDialog.Builder(this)
            .setTitle("Board in den Download-Modus")
            .setMessage("ESP32 jetzt:\n1. BOOT halten\n2. EN/RESET kurz drücken, loslassen\n3. BOOT loslassen\n\nDann OK.")
            .setPositiveButton("OK") { _, _ -> onProceed() }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    private fun runBusy(block: () -> Unit) {
        busy = true
        thread(isDaemon = true) {
            try { block() } catch (e: Exception) { log("Fehler: ${e.message}") } finally { busy = false }
        }
    }

    private fun log(msg: String) {
        Log.i("RoboCode", msg)
        runOnUiThread {
            logView.append(msg + "\n")
            logScroll.post { logScroll.fullScroll(ScrollView.FOCUS_DOWN) }
        }
    }

    private fun toast(s: String) = runOnUiThread { Toast.makeText(this, s, Toast.LENGTH_SHORT).show() }

    override fun onPause() {
        super.onPause()
        saveCurrentProject()   // Projekt (Code, Board, Pins, Name) sichern
    }

    override fun onResume() {
        super.onResume()
        aiCheckClipboard()     // KI-Antwort aus der Zwischenablage erkennen
    }

    override fun onDestroy() {
        super.onDestroy()
        terminalRunning = false
        if (usb.isOpen) usb.close()
        try { unregisterReceiver(usbReceiver) } catch (_: Exception) {}
    }

    // ---------------- Projektverwaltung (0.1) ----------------

    private fun createSeedProject() = RoboProject(
        ProjectStore.newId(), "Mein Programm", Boards.ALL[0].id, null, seedSetup(), seedMain(), seedLib(),
        seedDashboard(),
    )

    // Roadmap 1: Start-Tafel passend zu den Beispiel-Logzeilen in seedMain().
    private fun seedDashboard() = mutableListOf(
        Widget(newWidgetId(), WidgetType.GAU, "TEMP", 0.0, 50.0),
        Widget(newWidgetId(), WidgetType.BAR, "DIST", 0.0, 100.0),
        Widget(newWidgetId(), WidgetType.LED, "LED"),
    )

    /** Zuletzt genutztes Projekt laden — oder implizit ein Default anlegen. */
    private fun loadCurrentProject() {
        val p = ProjectStore.currentId(this)?.let { ProjectStore.load(this, it) }
            ?: ProjectStore.list(this).firstOrNull()?.let { ProjectStore.load(this, it.id) }
            ?: createSeedProject().also { ProjectStore.save(this, it); ProjectStore.setCurrent(this, it.id) }
        applyProject(p)
    }

    /** Ein Projekt in die Oberfläche übernehmen (Code-Tabs, Board, Pins, Name). */
    private fun applyProject(p: RoboProject) {
        currentId = p.id; currentName = p.name
        val idx = Boards.ALL.indexOfFirst { it.id == p.boardId }.coerceAtLeast(0)
        syncingBoard = true
        spinnerBoard.setSelection(idx); spinnerBoardCfg.setSelection(idx)
        syncingBoard = false
        lastBoardIdx = idx
        projectPins = p.pins
        dashboard = p.dashboard
        if (::dashBox.isInitialized) rebuildDashViews()
        tabs["setup"] = p.setup; tabs["main"] = p.main; tabs["lib"] = p.lib
        editorLoaded = false
        switchTab("main")
        ProjectStore.setCurrent(this, p.id)
        projectsInfo = ProjectStore.list(this)
        updateProjectTitle()
        if (::boardRow.isInitialized) buildBoardPanel()
    }

    private fun updateProjectTitle() {
        findViewById<TextView>(R.id.btnProject).text = "$currentName  ▾"
    }

    /** Aktuellen Oberflächen-Zustand als Projekt-Datensatz einsammeln. */
    private fun snapshotProject(): RoboProject {
        if (editorLoaded) tabs[active] = editor.text?.toString() ?: ""
        return RoboProject(
            currentId, currentName, selectedBoard().id, projectPins,
            tabs["setup"] ?: "", tabs["main"] ?: "", tabs["lib"] ?: "",
            dashboard,
        )
    }

    private fun saveCurrentProject() {
        if (currentId.isEmpty()) return
        val p = snapshotProject()
        ProjectStore.save(this, p); ProjectStore.setCurrent(this, p.id)
        projectsInfo = ProjectStore.list(this)
    }

    private fun uniqueName(base: String): String {
        val names = projectsInfo.map { it.name }.toSet()
        if (base !in names) return base
        var i = 2; while ("$base $i" in names) i++; return "$base $i"
    }

    private fun newProject() {
        saveCurrentProject()
        val p = createSeedProject().also { it.name = uniqueName("Programm") }
        ProjectStore.save(this, p); applyProject(p)
    }

    /** Aktuelles Projekt als NEUES Projekt kopieren. Das Original bleibt
     *  unverändert (wird nur gesichert, nicht umbenannt); die Kopie bekommt [newName]. */
    private fun duplicateProject(newName: String) {
        saveCurrentProject()                 // Original sichern, NICHT umbenennen
        val cur = snapshotProject()
        val copy = cur.copy(
            id = ProjectStore.newId(),
            name = uniqueName(newName.trim().ifBlank { "${cur.name} Kopie" }),
            pins = cur.pins?.map { it.copy() }?.toMutableList(),
            dashboard = cur.dashboard.map { it.copy() }.toMutableList(),
        )
        ProjectStore.save(this, copy); applyProject(copy)
    }

    private fun openProject(id: String) {
        saveCurrentProject()
        ProjectStore.load(this, id)?.let { applyProject(it) }
    }

    private fun removeProject(id: String) {
        ProjectStore.delete(this, id)
        projectsInfo = ProjectStore.list(this)
        if (id == currentId) {
            val next = projectsInfo.firstOrNull()?.let { ProjectStore.load(this, it.id) }
                ?: createSeedProject().also { ProjectStore.save(this, it) }
            applyProject(next)
        }
    }

    private fun renameCurrent(name: String) {
        currentName = name.trim().ifBlank { "Programm" }
        saveCurrentProject(); updateProjectTitle()
    }

    /**
     * Projekt-Menü. Klare, getrennte Aktionen (kein implizites Umbenennen mehr):
     * Namensfeld + „Umbenennen" wirken NUR aufs aktuelle Projekt; „Speichern"
     * sichert den aktuellen Stand; „Neu" legt ein neues Projekt an; „Kopieren"
     * fragt den Namen der Kopie ab und lässt das Original unverändert; die Liste
     * öffnet/löscht Projekte.
     */
    private fun showProjectDialog() {
        val ctx = this
        projectsInfo = ProjectStore.list(this)
        val root = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(12), dp(18), dp(4)) }
        val listBox = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val dialog = AlertDialog.Builder(ctx)
            .setView(ScrollView(ctx).apply { addView(root) })
            .setPositiveButton("Fertig", null).create()

        val nameEdit = EditText(ctx).apply {
            setText(currentName); setSingleLine(true)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        fun refresh() {
            listBox.removeAllViews()
            for (info in projectsInfo) {
                val isCur = info.id == currentId
                listBox.addView(LinearLayout(ctx).apply {
                    orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL
                    addView(TextView(ctx).apply {
                        text = info.name + (if (isCur) "  •" else "")
                        textSize = 14f; setPadding(dp(2), dp(8), dp(8), dp(8))
                        setTextColor(if (isCur) GREEN else ICON)
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                        setOnClickListener { openProject(info.id); dialog.dismiss() }
                    })
                    addView(TextView(ctx).apply {
                        text = "✕"; textSize = 15f; setTextColor(GRAY); setPadding(dp(10), dp(8), dp(6), dp(8))
                        setOnClickListener { confirmDelete(info) { projectsInfo = ProjectStore.list(ctx); refresh() } }
                    })
                })
            }
        }

        // Namenszeile: Feld + eigene Umbenennen-Aktion (wirkt nur aufs aktuelle Projekt).
        root.addView(TextView(ctx).apply { text = "Aktuelles Projekt"; textSize = 11f; setTextColor(GRAY) })
        root.addView(LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL
            addView(nameEdit)
            addView(Button(ctx).apply {
                text = "Umbenennen"; textSize = 12f
                setOnClickListener {
                    renameCurrent(nameEdit.text?.toString() ?: currentName)
                    projectsInfo = ProjectStore.list(ctx); refresh(); toast("Umbenannt")
                }
            })
        })

        // Aktionszeile: Speichern · Neu · Kopieren.
        root.addView(LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(8), 0, dp(8))
            fun act(label: String, onClick: () -> Unit) = addView(Button(ctx).apply {
                text = label; textSize = 12f
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                setOnClickListener { onClick() }
            })
            act("Speichern") { saveCurrentProject(); toast("Gespeichert") }
            act("+ Neu") { newProject(); dialog.dismiss() }
            act("Kopieren") { dialog.dismiss(); promptCopyName() }
        })

        root.addView(TextView(ctx).apply { text = "Projekte"; textSize = 11f; setTextColor(GRAY); setPadding(0, dp(4), 0, 0) })
        root.addView(listBox)
        refresh()
        dialog.show()
    }

    /** Fragt den Namen der Kopie ab und dupliziert das aktuelle Projekt. */
    private fun promptCopyName() {
        val ctx = this
        val input = EditText(ctx).apply {
            setText("$currentName Kopie"); setSingleLine(true); setSelectAllOnFocus(true)
        }
        AlertDialog.Builder(ctx)
            .setTitle("Projekt kopieren")
            .setView(ScrollView(ctx).apply { addView(input); setPadding(dp(18), dp(8), dp(18), 0) })
            .setPositiveButton("Kopieren") { _, _ -> duplicateProject(input.text?.toString() ?: "") }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    private fun confirmDelete(info: ProjectStore.Info, after: () -> Unit) {
        AlertDialog.Builder(this).setTitle("Projekt löschen?")
            .setMessage("„${info.name}“ wird dauerhaft gelöscht.")
            .setPositiveButton("Löschen") { _, _ -> removeProject(info.id); after() }
            .setNegativeButton("Abbrechen", null).show()
    }

    // ---------------- Startseite / Project Launcher (P1) ----------------

    // Vollflächiges Overlay über der Oberfläche; null = nicht sichtbar.
    private var launcherView: View? = null

    /** Startseite zeigen: Projektliste (Neu / Fortsetzen / Öffnen / Starten). */
    private fun showLauncher() {
        val content = findViewById<android.widget.FrameLayout>(android.R.id.content)
        launcherView?.let { content.removeView(it) }
        val v = buildLauncherView()
        launcherView = v
        content.addView(
            v,
            android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
    }

    private fun hideLauncher() {
        launcherView?.let { (it.parent as? android.view.ViewGroup)?.removeView(it) }
        launcherView = null
    }

    private fun buildLauncherView(): View {
        val ctx = this
        projectsInfo = ProjectStore.list(this)
        val root = ScrollView(ctx).apply {
            setBackgroundColor(0xFFFFFFFF.toInt())
            isClickable = true // Touches nicht an die Oberfläche darunter durchreichen
        }
        val col = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(28), dp(22), dp(24))
        }
        root.addView(col)

        col.addView(TextView(ctx).apply {
            text = "RoboCode"; textSize = 26f; setTextColor(ICON)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        })
        col.addView(TextView(ctx).apply {
            text = "Wähle ein Projekt oder leg ein neues an."
            textSize = 13f; setTextColor(GRAY); setPadding(0, dp(4), 0, dp(16))
        })

        col.addView(launcherButton("+  Neues Projekt", GREEN) {
            newProject(); hideLauncher(); showPanel(panelCode)
        })
        if (currentId.isNotEmpty()) {
            col.addView(launcherButton("▸  Fortsetzen — $currentName", ICON) {
                hideLauncher(); showPanel(panelCode)
            })
        }

        col.addView(TextView(ctx).apply {
            text = "PROJEKTE"; textSize = 11f; setTextColor(GRAY)
            setPadding(dp(2), dp(22), 0, dp(4)); letterSpacing = 0.08f
        })
        if (projectsInfo.isEmpty()) {
            col.addView(TextView(ctx).apply {
                text = "Noch keine gespeicherten Projekte."
                textSize = 13f; setTextColor(GRAY); setPadding(dp(2), dp(6), 0, 0)
            })
        }
        for (info in projectsInfo) col.addView(buildLauncherRow(info))
        return root
    }

    private fun launcherButton(label: String, color: Int, onClick: () -> Unit): View =
        TextView(this).apply {
            text = label; textSize = 15f; setTextColor(0xFFFFFFFF.toInt())
            isSingleLine = true; ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(10).toFloat(); setColor(color)
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(8) }
            isClickable = true
            setOnClickListener { onClick() }
        }

    /** Projektzeile: Name öffnet im Editor; Projekte mit Tafel sind direkt startbar. */
    private fun buildLauncherRow(info: ProjectStore.Info): View {
        val ctx = this
        val hasDash = ProjectStore.load(ctx, info.id)?.dashboard?.isNotEmpty() == true
        val isCur = info.id == currentId
        return LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(10).toFloat(); setColor(0xFFF2F4F7.toInt())
                if (isCur) setStroke(dp(2), GREEN)
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(8) }
            setPadding(dp(14), dp(12), dp(10), dp(12))

            addView(LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                addView(TextView(ctx).apply {
                    text = info.name; textSize = 16f; setTextColor(ICON)
                    isSingleLine = true; ellipsize = android.text.TextUtils.TruncateAt.END
                })
                addView(TextView(ctx).apply {
                    text = if (hasDash) "mit Tafel" else "Programm"
                    textSize = 11f; setTextColor(GRAY)
                })
                isClickable = true
                setOnClickListener { openProject(info.id); hideLauncher(); showPanel(panelCode) }
            })

            if (hasDash) addView(TextView(ctx).apply {
                text = "▶ Starten"; textSize = 13f; setTextColor(0xFFFFFFFF.toInt())
                setPadding(dp(12), dp(8), dp(12), dp(8))
                background = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = dp(8).toFloat(); setColor(GREEN)
                }
                isClickable = true
                setOnClickListener { openProject(info.id); hideLauncher(); showPanelByName("tafel") }
            })
        }
    }

    override fun onBackPressed() {
        // Aus dem Editor zurück → Startseite; von der Startseite → App verlassen.
        if (launcherView == null) showLauncher() else super.onBackPressed()
    }

    // ---------------- Programmieren mit KI (P1) ----------------

    /** Vorhandene Board-Objekte des aktuellen Projekts als Text für den Kontext. */
    private fun aiBoardContext(): String {
        val bk = selectedBoard().banks
        val sb = StringBuilder()
        sb.append("- Board: ${selectedBoard().name}\n")
        if (bk.doPins.isNotEmpty())
            sb.append("- Digitalausgänge: ${bk.doPins.indices.joinToString(", ") { "b.do$it" }}\n")
        if (bk.diPins.isNotEmpty())
            sb.append("- Digitaleingänge: ${bk.diPins.indices.joinToString(", ") { "b.di$it" }}\n")
        if (bk.aPins.isNotEmpty())
            sb.append("- Analogeingänge: ${bk.aPins.indices.joinToString(", ") { "b.a$it" }}\n")
        val named = namedPins()
        if (named.isNotEmpty())
            sb.append("- Eigene Namen: ${named.joinToString(", ") { "${it.name} (GPIO ${it.gpio})" }}\n")
        return sb.toString().trimEnd()
    }

    /** Aktuelles Programm (MAIN) als optionaler Kontext zum Erweitern. */
    private fun aiCurrentProgram(): String {
        if (editorLoaded) tabs[active] = editor.text?.toString() ?: ""
        return tabs["main"]?.trim().orEmpty()
    }

    /** Einstieg: an KI-App senden oder nur den Kontext in die Zwischenablage legen. */
    private fun showAiDialog() {
        saveCurrentProject()
        AlertDialog.Builder(this)
            .setTitle("Mit KI programmieren")
            .setMessage(
                "RoboCode schickt die Syntax, deine Board-Belegung und (optional) dein " +
                    "aktuelles Programm an eine KI-App. Dort beschreibst du die Aufgabe. " +
                    "Die Antwort kommt über die Zwischenablage zurück.",
            )
            .setPositiveButton("An KI-App senden") { _, _ -> aiSend() }
            .setNeutralButton("Nur Kontext kopieren") { _, _ -> aiCopyContext() }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    private fun aiBuildAndRemember(): AiAssist.Request {
        val id = AiAssist.newRequestId()
        val prompt = AiAssist.buildPrompt(id, aiBoardContext(), aiCurrentProgram())
        aiRequestId = id
        aiSentPrompt = prompt
        aiLastHandledClip = null
        copyToClipboard("RoboCode-KI", prompt)
        return AiAssist.Request(id, prompt)
    }

    private fun aiSend() {
        val req = aiBuildAndRemember()
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"; putExtra(Intent.EXTRA_TEXT, req.prompt)
        }
        try {
            startActivity(Intent.createChooser(send, "KI-App wählen"))
            toast("Kontext gesendet (${req.id}). Antwort kopieren und zurückkehren.")
        } catch (e: Exception) {
            toast("Keine App gefunden — Kontext liegt in der Zwischenablage.")
        }
    }

    private fun aiCopyContext() {
        val req = aiBuildAndRemember()
        toast("Kontext kopiert (${req.id}). In die KI-App einfügen, Antwort kopieren, zurückkehren.")
    }

    private fun copyToClipboard(label: String, text: String) =
        (getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager)
            .setPrimaryClip(android.content.ClipData.newPlainText(label, text))

    private fun readClipboard(): String? {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        val clip = cm.primaryClip ?: return null
        if (clip.itemCount == 0) return null
        return clip.getItemAt(0).coerceToText(this)?.toString()
    }

    /** Beim Zurückkehren: enthält die Zwischenablage eine Antwort zur offenen Anfrage? */
    private fun aiCheckClipboard() {
        val id = aiRequestId ?: return
        val clip = readClipboard() ?: return
        if (clip == aiLastHandledClip) return
        val code = AiAssist.extractAnswer(clip, id, aiSentPrompt) ?: return
        aiLastHandledClip = clip
        aiShowAnswer(id, code)
    }

    private fun aiShowAnswer(id: String, code: String) {
        val ctx = this
        val preview = TextView(ctx).apply {
            text = code; textSize = 12f; setTextColor(ICON)
            typeface = android.graphics.Typeface.MONOSPACE
            setPadding(dp(14), dp(10), dp(14), dp(10))
        }
        AlertDialog.Builder(ctx)
            .setTitle("KI-Antwort erkannt ($id)")
            .setView(ScrollView(ctx).apply { addView(preview) })
            .setPositiveButton("In MAIN übernehmen") { _, _ -> aiApply("main", code) }
            .setNeutralButton("Anderer Tab…") { _, _ -> aiChooseTarget(code) }
            .setNegativeButton("Verwerfen") { _, _ -> aiClearRequest() }
            .show()
    }

    private fun aiChooseTarget(code: String) {
        val labels = arrayOf("MAIN", "SETUP", "LIB")
        val keys = arrayOf("main", "setup", "lib")
        AlertDialog.Builder(this)
            .setTitle("Code einfügen in…")
            .setItems(labels) { _, which -> aiApply(keys[which], code) }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    private fun aiApply(tabKey: String, code: String) {
        tabs[tabKey] = code
        editorLoaded = false          // verhindert, dass switchTab den alten Inhalt zurückschreibt
        switchTab(tabKey)
        showPanel(panelCode)
        saveCurrentProject()
        aiClearRequest()
        toast("Code übernommen in ${tabKey.uppercase()}")
    }

    private fun aiClearRequest() {
        aiRequestId = null; aiSentPrompt = null; aiLastHandledClip = null
    }

    // ---------------- Seeds ----------------

    private fun seedSetup() = listOf(
        "# Das Board b ist schon da: b.do0..5, b.di0..1, b.a0..4",
        "# (hier nur noetig, wenn du eigene Geraete benennen willst)",
    ).joinToString("\n")

    private fun seedMain() = listOf(
        "# Blinken + Werte an die Tafel senden (Term -> „Tafel“)",
        "n = 0",
        "while True:",
        "    b.do3 = 1",
        "    log(\"LED:1\")",
        "    log(\"TEMP:\" + str(20 + n % 15))",
        "    log(\"DIST:\" + str(n % 100))",
        "    wait(500)",
        "    b.do3 = 0",
        "    log(\"LED:0\")",
        "    wait(500)",
        "    n = n + 1",
    ).joinToString("\n")

    private fun seedLib() = listOf("# Eigene Funktionen (hier nichts nötig)").joinToString("\n")

    companion object {
        private val GREEN = 0xFF2ECC71.toInt()
        private val ORANGE = 0xFFE67E22.toInt()
        private val RED = 0xFFC0392B.toInt()
        private val GRAY = 0xFF8A93A2.toInt()
        private val ICON = 0xFF374151.toInt()
    }
}
