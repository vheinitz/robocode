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

    private lateinit var panelCode: View
    private lateinit var panelBoard: View
    private lateinit var panelDevice: View
    private lateinit var panelMain: View
    private lateinit var panelTerminal: View
    private lateinit var panelLog: View

    // Läuft die Terminal-Leseschleife (Port bleibt offen, Programmausgabe wird gelesen)?
    @Volatile private var terminalRunning = false

    private val tabs = linkedMapOf("setup" to seedSetup(), "main" to seedMain(), "lib" to seedLib())
    private var active = "setup"
    private var suppressWatcher = false
    private var editorLoaded = false

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
                if (syncingBoard) return
                syncingBoard = true
                spinnerBoard.setSelection(pos)
                spinnerBoardCfg.setSelection(pos)
                syncingBoard = false
                projectPins = null            // gehörte zum alten Board
                buildBoardPanel()
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

        editor.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) { if (!suppressWatcher) tabs[active] = s?.toString() ?: "" }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })

        switchTab("main")   // nur MAIN sichtbar; SETUP/LIB sind ausgeblendet
        showPanel(panelCode)
        intent?.getStringExtra("panel")?.let { pinnedPanel = it; showPanelByName(it) }

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
        "terminal" -> showPanel(panelTerminal)
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

    private fun clonePins() { projectPins = selectedBoard().defaultPins().toMutableList(); buildBoardPanel() }
    private fun resetPins() { projectPins = null; buildBoardPanel() }

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
            children.add(gpioLabelView(null))
            children.add(powerChip(slot.power))
            children.add(spacerView(dp(46)))
        } else {
            val p = byGpio[slot.gpio] ?: return row
            children.add(gpioLabelView(p.gpio))
            if (p.role in PinRole.RESERVED) {
                children.add(reservedChip(p)); children.add(roleBadge(p.role))
            } else {
                children.add(nameField(p)); children.add(roleSpinner(p))
            }
        }
        // `side == "l"`: Reihenfolge drehen, damit das GPIO-Label zur Platine zeigt.
        for (v in if (side == "l") children.reversed() else children) row.addView(v)
        return row
    }

    private fun chipBg(fill: Int, stroke: Int) = android.graphics.drawable.GradientDrawable().apply {
        cornerRadius = dp(4).toFloat(); setColor(fill); setStroke(dp(1), stroke)
    }

    private fun gpioLabelView(gpio: Int?): TextView = TextView(this).apply {
        text = if (gpio != null) "G$gpio" else ""
        textSize = 10f; setTextColor(0xFF9CA3AF.toInt())
        typeface = android.graphics.Typeface.MONOSPACE
        gravity = android.view.Gravity.END
        setPadding(0, 0, dp(2), 0)
        layoutParams = LinearLayout.LayoutParams(dp(26), LinearLayout.LayoutParams.WRAP_CONTENT)
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
        layoutParams = LinearLayout.LayoutParams(dp(34), LinearLayout.LayoutParams.WRAP_CONTENT)
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
            layoutParams = LinearLayout.LayoutParams(dp(46), LinearLayout.LayoutParams.WRAP_CONTENT)
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
        }
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

    override fun onDestroy() {
        super.onDestroy()
        terminalRunning = false
        if (usb.isOpen) usb.close()
        try { unregisterReceiver(usbReceiver) } catch (_: Exception) {}
    }

    // ---------------- Seeds ----------------

    private fun seedSetup() = listOf(
        "# Das Board b ist schon da: b.do0..5, b.di0..1, b.a0..4",
        "# (hier nur noetig, wenn du eigene Geraete benennen willst)",
    ).joinToString("\n")

    private fun seedMain() = listOf(
        "# Blinken + seriell senden (erscheint im Terminal)",
        "n = 0",
        "while True:",
        "    b.do3 = 1",
        "    log(\"blink\", n)",
        "    wait(500)",
        "    b.do3 = 0",
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
