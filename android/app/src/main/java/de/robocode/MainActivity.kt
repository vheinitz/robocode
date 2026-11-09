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
    private lateinit var spinnerBoard: Spinner
    private lateinit var txtStatus: TextView
    private lateinit var txtDeviceInfo: TextView
    private lateinit var btnInstall: Button
    private lateinit var btnStart: Button
    private lateinit var logView: TextView
    private lateinit var logScroll: ScrollView
    private lateinit var mainPyView: TextView

    private lateinit var panelCode: View
    private lateinit var panelDevice: View
    private lateinit var panelMain: View
    private lateinit var panelLog: View

    private val tabs = linkedMapOf("setup" to seedSetup(), "main" to seedMain(), "lib" to seedLib())
    private var active = "setup"
    private var suppressWatcher = false
    private var editorLoaded = false

    @Volatile private var busy = false
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
        spinnerBoard = findViewById(R.id.spinnerBoard)
        txtStatus = findViewById(R.id.txtStatus)
        txtDeviceInfo = findViewById(R.id.txtDeviceInfo)
        btnInstall = findViewById(R.id.btnInstall)
        btnStart = findViewById(R.id.btnStart)
        logView = findViewById(R.id.log)
        logScroll = findViewById(R.id.logScroll)
        mainPyView = findViewById(R.id.mainPyView)
        panelCode = findViewById(R.id.panelCode)
        panelDevice = findViewById(R.id.panelDevice)
        panelMain = findViewById(R.id.panelMain)
        panelLog = findViewById(R.id.panelLog)

        usb = UsbSerialLink(this)
        spinnerBoard.adapter = ArrayAdapter(
            this, android.R.layout.simple_spinner_dropdown_item, Boards.ALL.map { it.name },
        )

        // Top-Navigation
        findViewById<Button>(R.id.navCode).setOnClickListener { showPanel(panelCode) }
        findViewById<Button>(R.id.navDevice).setOnClickListener { showPanel(panelDevice) }
        findViewById<Button>(R.id.navMain).setOnClickListener { refreshMainPy(); showPanel(panelMain) }
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

        editor.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) { if (!suppressWatcher) tabs[active] = s?.toString() ?: "" }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })

        switchTab("setup")
        showPanel(panelCode)

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
        for (v in listOf(panelCode, panelDevice, panelMain, panelLog)) v.visibility = if (v === p) View.VISIBLE else View.GONE
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

    private fun buildPalette(key: String) {
        palette.removeAllViews()
        val tokens: List<Pair<String, String>> = when (key) {
            "setup" -> listOf(
                "📥 DI" to "eingang = DI(4)", "📤 DO" to "ausgang = DO(5)",
                "🎚️ AI" to "poti = AI(0)", "🔆 AO" to "dimmer = AO(5)",
                "💡 LED" to "led = LED(13)", "🌈 RGB" to "rgb = RGB(2)",
                "🔘 Taster" to "taster = TASTER(2)", "⚙️ Motor" to "motor = MOTOR(6, 7)",
            )
            else -> buildList {
                add("🔁 while" to "while True:")
                add("❓ if" to "if :")
                add("❓! elif" to "elif :")
                add("sonst" to "else:")
                if (key == "lib") add("🧩 def" to "def name():")
                add("⏱ sleep" to "sleep_ms(100)")
                add("Takt" to "takt = Every(300)")
                add("= 1" to ".v = 1"); add("= 0" to ".v = 0")
                add("umsch." to ".toggle()"); add(">" to " > ")
                for (n in deviceNames()) add(n to n)
            }
        }
        for ((label, text) in tokens) {
            palette.addView(Button(this).apply {
                this.text = label; isAllCaps = false
                setOnClickListener { insertAtCursor(text) }
            })
        }
    }

    private fun deviceNames(): List<String> =
        Regex("(?m)^\\s*([A-Za-z_]\\w*)\\s*=(?!=)").findAll(tabs["setup"] ?: "")
            .map { it.groupValues[1] }.distinct().toList()

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
                showPanel(panelDevice)
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
                    showPanel(panelCode)
                }
            } else {
                log("ESP32 ohne MicroPython.")
                runOnUiThread {
                    setStatus("● ohne MicroPython", ORANGE)
                    btnStart.isEnabled = false; btnInstall.isEnabled = true
                    txtDeviceInfo.text = "ESP32 erkannt, aber kein MicroPython.\n→ »MicroPython installieren«."
                    showPanel(panelDevice)
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
            log("— Ausgabe (print) —")
            repl.follow(4000, listener)
            log("Läuft. main.py startet nun auch bei jedem Boot.")
        } catch (e: Exception) {
            log("Fehler: ${e.message}")
        } finally {
            usb.close()
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
        if (usb.isOpen) usb.close()
        try { unregisterReceiver(usbReceiver) } catch (_: Exception) {}
    }

    // ---------------- Seeds ----------------

    private fun seedSetup() = listOf(
        "# Onboard-LED am ESP32-C3",
        "led = DO(8)        # viele C3-Boards: einfache LED an GPIO8",
        "# rgb = RGB(2)     # Boards mit WS2812 stattdessen so",
    ).joinToString("\n")

    private fun seedMain() = listOf(
        "# Blinken — ohne Taster",
        "while True:",
        "    led.v = 1",
        "    sleep_ms(500)",
        "    led.v = 0",
        "    sleep_ms(500)",
    ).joinToString("\n")

    private fun seedLib() = listOf("# Eigene Funktionen (hier nichts nötig)").joinToString("\n")

    companion object {
        private val GREEN = 0xFF2ECC71.toInt()
        private val ORANGE = 0xFFE67E22.toInt()
        private val RED = 0xFFC0392B.toInt()
        private val GRAY = 0xFF8A93A2.toInt()
    }
}
