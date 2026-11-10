package de.robocode

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.util.Log
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
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
    private lateinit var txtStatus: TextView
    private lateinit var txtDeviceInfo: TextView
    private lateinit var btnInstall: Button
    private lateinit var btnStart: Button
    private lateinit var logView: TextView
    private lateinit var logScroll: ScrollView
    private lateinit var mainPyView: TextView
    private lateinit var terminalIn: TextView
    private lateinit var terminalInScroll: ScrollView
    private lateinit var terminalOut: EditText

    private lateinit var panelCode: View
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
                    runOnUiThread { setStatus("● kein ESP32", RED); btnStart.isEnabled = false }
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
        panelDevice = findViewById(R.id.panelDevice)
        panelMain = findViewById(R.id.panelMain)
        panelTerminal = findViewById(R.id.panelTerminal)
        panelLog = findViewById(R.id.panelLog)

        usb = UsbSerialLink(this)
        spinnerBoard.adapter = ArrayAdapter(
            this, android.R.layout.simple_spinner_dropdown_item, Boards.ALL.map { it.name },
        )

        // Top-Navigation
        findViewById<Button>(R.id.navCode).setOnClickListener { showPanel(panelCode) }
        findViewById<Button>(R.id.navDevice).setOnClickListener { showPanel(panelDevice) }
        findViewById<Button>(R.id.navMain).setOnClickListener { refreshMainPy(); showPanel(panelMain) }
        findViewById<Button>(R.id.navTerminal).setOnClickListener { showPanel(panelTerminal) }
        findViewById<Button>(R.id.navLog).setOnClickListener { showPanel(panelLog) }

        // Code-Sub-Tabs
        findViewById<Button>(R.id.tabSetup).setOnClickListener { switchTab("setup") }
        findViewById<Button>(R.id.tabMain).setOnClickListener { switchTab("main") }
        findViewById<Button>(R.id.tabLib).setOnClickListener { switchTab("lib") }

        // Aktionen
        btnStart.setOnClickListener { onStartClicked() }
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
        for (v in listOf(panelCode, panelDevice, panelMain, panelTerminal, panelLog))
            v.visibility = if (v === p) View.VISIBLE else View.GONE
    }

    private fun showPanelByName(name: String) = when (name) {
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

    // Palette als aufklappbare Gruppen. Top-Zeile = Gruppen; beim Klick klappt
    // die Unter-Zeile mit den Elementen auf (Board hat noch eine dritte Stufe:
    // do/di/a -> Zahl). Icons folgen später; vorerst Textlabels.
    private val GROUPS = listOf("Board", "Kontrolle", "Operator", "Warte", "Seriell", "Mehr")

    private fun buildPalette(key: String) {
        grp = null; grpPort = null
        rebuildGroups()
    }

    /** Gruppen-Zeile (neu) zeichnen — markiert die offene Gruppe, ohne den
     *  Zustand zurückzusetzen; danach die Unter-Zeile aktualisieren. */
    private fun rebuildGroups() {
        palette.removeAllViews()
        for (g in GROUPS) {
            palette.addView(groupButton(g, active = (g == grp)) {
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
            "Kontrolle" -> addLeaves(
                "while" to "while True:", "for" to "for i in range(10):",
                "if" to "if :", "elif" to "elif :", "sonst" to "else:", "def" to "def name():",
            )
            "Operator" -> addLeaves(
                ">" to " > ", "<" to " < ", ">=" to " >= ", "<=" to " <= ", "==" to " == ",
                "=" to " = ", "+" to " + ", "-" to " - ", "und" to " and ", "oder" to " or ", "nicht" to "not ",
            )
            "Warte" -> buildWaitSub()
            "Seriell" -> addLeaves("log Text" to "log(\"Hallo\")", "log Wert" to "log(\"Wert:\", )")
            "Mehr" -> addLeaves("umschalten" to ".toggle()", "Farbe" to ".color(\"rot\")", "Takt" to "takt = Every(300)")
        }
        paletteSub.visibility = View.VISIBLE
    }

    private fun buildBoardSub() {
        val bk = selectedBoard().banks
        if (grpPort == null) {
            for (p in listOf("do", "di", "a")) leaf(p) { grpPort = p; refreshSub() }
        } else {
            leaf("‹ zurück") { grpPort = null; refreshSub() }
            val count = when (grpPort) { "do" -> bk.doPins.size; "di" -> bk.diPins.size; else -> bk.aPins.size }
            for (n in 0 until count) {
                val insert = if (grpPort == "do") "b.do$n = 1" else "b.$grpPort$n"
                leaf("$grpPort$n") { insertAtCursor(insert); grpPort = null; refreshSub() }
            }
        }
    }

    private fun buildWaitSub() {
        for (ms in listOf(100, 250, 500, 1000, 2000)) leaf("${ms}ms") { insertAtCursor("wait($ms)") }
        // Schieberegler als Eingabe
        val label = TextView(this).apply {
            text = "wait(500)"; setPadding(dp(12), 0, dp(8), 0)
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val seek = SeekBar(this).apply {
            max = 2000; progress = 500
            layoutParams = LinearLayout.LayoutParams(dp(160), LinearLayout.LayoutParams.WRAP_CONTENT)
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
        leaf("einfügen") { insertAtCursor("wait(${seek.progress})") }
    }

    // ---- Palette-Hilfen ----

    private fun addLeaves(vararg items: Pair<String, String>) {
        for ((label, text) in items) leaf(label) { insertAtCursor(text) }
    }

    private fun leaf(label: String, onClick: () -> Unit) {
        paletteSub.addView(Button(this).apply {
            text = label; isAllCaps = false
            setOnClickListener { onClick() }
        })
    }

    private fun groupButton(label: String, active: Boolean, onClick: () -> Unit): Button =
        Button(this).apply {
            text = label; isAllCaps = false
            if (active) setTextColor(GREEN)
            setOnClickListener { onClick() }
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
                    btnStart.isEnabled = true; btnInstall.isEnabled = false
                    txtDeviceInfo.text = "Verbunden. MicroPython läuft.\nBoard: ${selectedBoard().name}" +
                        (if (m != null) "\n$m" else "")
                    if (pinnedPanel == null) showPanel(panelCode)
                }
            } else {
                log("ESP32 ohne MicroPython.")
                runOnUiThread {
                    setStatus("● ohne MicroPython", ORANGE)
                    btnStart.isEnabled = false; btnInstall.isEnabled = true
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
            override fun progress(doneBytes: Int, totalBytes: Int) =
                this@MainActivity.log("… %d / %d Byte".format(doneBytes, totalBytes))
        }
        // Flashen: Steuerleitungen anlegen (Board im Download-Modus).
        if (!usb.open(driver, 115200, assertControlLines = true)) { log("Port öffnen fehlgeschlagen."); return }
        try {
            runOnUiThread { setStatus("● flashe…", GRAY) }
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
        }
        // Nach dem Reboot neu erkennen (Gerät re-enumeriert; kurz warten).
        try { Thread.sleep(1500) } catch (_: InterruptedException) {}
        autoConnect()
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
            selectedBoard(), robopy,
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
    }
}
