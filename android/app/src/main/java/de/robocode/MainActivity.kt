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
import android.util.Log
import android.text.Editable
import android.text.TextWatcher
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
 * RoboCode — native Android-App. Kein WebView: der Editor (SETUP/MAIN/LIB), der
 * Zusammenbau der main.py ([Assembler]) und die Übertragung laufen nativ.
 *
 * Ablauf: ESP32 erkennen -> prüfen ob MicroPython läuft ([MicroPythonRepl]). Wenn
 * nicht: MicroPython-Firmware flashen ([EspLoader], Download-Modus manuell). Wenn
 * ja: Code schreiben, „Start" baut die eine main.py zusammen, überträgt sie per
 * Raw-REPL, speichert sie als main.py und startet sie (läuft dann bei jedem Boot).
 */
class MainActivity : AppCompatActivity() {

    private lateinit var usb: UsbSerialLink

    private lateinit var editor: EditText
    private lateinit var palette: LinearLayout
    private lateinit var spinnerBoard: Spinner
    private lateinit var btnInstall: Button
    private lateinit var btnStart: Button
    private lateinit var logView: TextView
    private lateinit var logScroll: ScrollView

    // Drei Tabs als Quelltext (Seeds = Port von createPlaygroundProject()).
    private val tabs = linkedMapOf(
        "setup" to seedSetup(),
        "main" to seedMain(),
        "lib" to seedLib(),
    )
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
                    log(if (granted) "USB-Berechtigung erteilt — Aktion erneut auslösen."
                        else "USB-Berechtigung abgelehnt.")
                }
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> log("ESP32 angesteckt.")
                UsbManager.ACTION_USB_DEVICE_DETACHED -> log("ESP32 abgezogen.")
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        editor = findViewById(R.id.editor)
        palette = findViewById(R.id.palette)
        spinnerBoard = findViewById(R.id.spinnerBoard)
        btnInstall = findViewById(R.id.btnInstall)
        btnStart = findViewById(R.id.btnStart)
        logView = findViewById(R.id.log)
        logScroll = findViewById(R.id.logScroll)

        usb = UsbSerialLink(this)

        spinnerBoard.adapter = ArrayAdapter(
            this, android.R.layout.simple_spinner_dropdown_item, Boards.ALL.map { it.name },
        )

        findViewById<Button>(R.id.tabSetup).setOnClickListener { switchTab("setup") }
        findViewById<Button>(R.id.tabMain).setOnClickListener { switchTab("main") }
        findViewById<Button>(R.id.tabLib).setOnClickListener { switchTab("lib") }
        findViewById<Button>(R.id.btnConnect).setOnClickListener { onConnect() }
        btnInstall.setOnClickListener { onInstall() }
        btnStart.setOnClickListener { onStartClicked() }
        findViewById<Button>(R.id.btnShow).setOnClickListener { onShowMainPy() }

        editor.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) { if (!suppressWatcher) tabs[active] = s?.toString() ?: "" }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })

        switchTab("setup")

        val filter = IntentFilter(actionUsbPermission).apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        ContextCompat.registerReceiver(this, usbReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)

        log("Bereit. ESP32 anstecken, »Verbinden & prüfen«.")
    }

    // ---------------- Editor / Tabs / Palette ----------------

    private fun switchTab(key: String) {
        // Nur zurückschreiben, wenn der Editor den aktiven Tab schon anzeigt —
        // sonst würde der erste Aufruf den Seed mit leerem Text überschreiben.
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
                // Gerätenamen aus SETUP als Tasten
                for (n in deviceNames()) add(n to n)
            }
        }
        for ((label, text) in tokens) {
            val b = Button(this).apply {
                this.text = label
                isAllCaps = false
                setOnClickListener { insertAtCursor(text) }
            }
            palette.addView(b)
        }
    }

    /** Zugewiesene Namen aus dem SETUP-Tab (z. B. led = LED(13)). */
    private fun deviceNames(): List<String> {
        val re = Regex("(?m)^\\s*([A-Za-z_]\\w*)\\s*=(?!=)")
        return re.findAll(tabs["setup"] ?: "").map { it.groupValues[1] }.distinct().toList()
    }

    /** Token an der Cursor-Position einfügen; nach ':' automatisch einrücken. */
    private fun insertAtCursor(text: String) {
        var t = text
        if (t.trimEnd().endsWith(":")) t += "\n    "
        val s = max(editor.selectionStart, 0)
        val e = max(editor.selectionEnd, 0)
        editor.text.replace(min(s, e), max(s, e), t)
    }

    private fun selectedBoard(): Board = Boards.ALL[max(spinnerBoard.selectedItemPosition, 0)]

    // ---------------- Verbinden / Erkennen ----------------

    private fun onConnect() {
        if (busy) { toast("Läuft bereits…"); return }
        val driver = usb.findDriver() ?: run { toast("Kein ESP32 / USB-Serial erkannt"); return }
        if (!ensurePermission(driver.device)) return
        runBusy { doDetect(driver) }
    }

    private fun doDetect(driver: UsbSerialDriver) {
        // REPL: Steuerleitungen NICHT anlegen (sonst Bootloader statt MicroPython).
        if (!usb.open(driver, 115200, assertControlLines = false)) { log("Port öffnen fehlgeschlagen."); return }
        try {
            val repl = MicroPythonRepl(usb)
            log("Prüfe auf MicroPython…")
            if (repl.isMicroPython()) {
                log("✓ MicroPython erkannt. »▶ Start« ist frei.")
                runOnUiThread { btnStart.isEnabled = true; btnInstall.isEnabled = false }
            } else {
                log("Kein MicroPython erkannt. »MicroPython installieren« drücken (Board im Download-Modus).")
                runOnUiThread { btnInstall.isEnabled = true; btnStart.isEnabled = false }
            }
        } finally {
            usb.close()
        }
    }

    // ---------------- MicroPython installieren (flashen) ----------------

    private fun onInstall() {
        if (busy) { toast("Läuft bereits…"); return }
        val board = selectedBoard()
        val img = loadFirmwareAsset(board.firmwareAsset) ?: run {
            log("Firmware fehlt: assets/firmware/${board.firmwareAsset}\n→ von micropython.org herunterladen und dort ablegen (siehe README).")
            return
        }
        val driver = usb.findDriver() ?: run { toast("Kein ESP32 erkannt"); return }
        if (!ensurePermission(driver.device)) return
        showBootDialog {
            runBusy { doFlash(driver, img, board.flashOffset) }
        }
    }

    private fun doFlash(driver: UsbSerialDriver, img: ByteArray, offset: Int) {
        val listener = object : EspLoader.Listener {
            override fun log(msg: String) = this@MainActivity.log(msg)
            override fun progress(doneBytes: Int, totalBytes: Int) = this@MainActivity.log(
                "… %d / %d Byte".format(doneBytes, totalBytes),
            )
        }
        if (!usb.open(driver, 115200)) { log("Port öffnen fehlgeschlagen."); return }
        try {
            log("Synchronisiere mit ROM-Bootloader…")
            val loader = EspLoader(usb)
            if (!loader.connect(listener)) { log("Keine Antwort. Board im Download-Modus?"); return }
            val ok = loader.flash(img, offset, listener)
            log(if (ok) "✓ MicroPython geflasht. Jetzt »Verbinden & prüfen«." else "✗ Flashen fehlgeschlagen.")
        } catch (e: Exception) {
            log("Fehler: ${e.message}")
        } finally {
            usb.close()
        }
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
        // REPL: Steuerleitungen NICHT anlegen (sonst Bootloader statt MicroPython).
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
        } catch (e: Exception) {
            log("DSL-Asset fehlt: dsl/robopy.py (${e.message})"); ""
        }
        return Assembler.assemble(
            Assembler.Parts(tabs["setup"] ?: "", tabs["lib"] ?: "", tabs["main"] ?: ""),
            selectedBoard(), robopy,
        )
    }

    private fun onShowMainPy() {
        tabs[active] = editor.text?.toString() ?: ""
        val scroll = ScrollView(this)
        val tv = TextView(this).apply {
            text = assembleMainPy(); typeface = android.graphics.Typeface.MONOSPACE
            textSize = 11f; setTextIsSelectable(true); setPadding(24, 24, 24, 24)
        }
        scroll.addView(tv)
        AlertDialog.Builder(this).setTitle("main.py (zusammengebaut)").setView(scroll)
            .setPositiveButton("Schließen", null).show()
    }

    // ---------------- USB-Berechtigung / Hilfen ----------------

    private fun ensurePermission(device: UsbDevice): Boolean {
        if (usb.hasPermission(device)) return true
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        val pi = PendingIntent.getBroadcast(this, 0, Intent(actionUsbPermission).setPackage(packageName), flags)
        (getSystemService(Context.USB_SERVICE) as UsbManager).requestPermission(device, pi)
        log("USB-Berechtigung angefragt — nach Bestätigung Aktion erneut auslösen.")
        return false
    }

    private fun loadFirmwareAsset(name: String): ByteArray? = try {
        assets.open("firmware/$name").use { it.readBytes() }
    } catch (_: Exception) { null }

    private fun showBootDialog(onProceed: () -> Unit) {
        AlertDialog.Builder(this)
            .setTitle("Board in den Download-Modus")
            .setMessage(
                "ESP32 jetzt in den Download-Modus bringen:\n\n" +
                    "1. BOOT gedrückt halten\n2. EN/RESET kurz drücken, loslassen\n3. BOOT loslassen\n\nDann OK.",
            )
            .setPositiveButton("OK") { _, _ -> onProceed() }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    /** Hintergrund-Thread mit Busy-Flag (USB-IO nie im UI-Thread). */
    private fun runBusy(block: () -> Unit) {
        busy = true
        thread(isDaemon = true) {
            try { block() } catch (e: Exception) { log("Fehler: ${e.message}") } finally { busy = false }
        }
    }

    private fun log(msg: String) {
        Log.i("RoboCode", msg) // auch per `adb logcat -s RoboCode` sichtbar
        runOnUiThread {
            logView.append(msg + "\n")
            logScroll.post { logScroll.fullScroll(ScrollView.FOCUS_DOWN) }
        }
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    override fun onDestroy() {
        super.onDestroy()
        if (usb.isOpen) usb.close()
        try { unregisterReceiver(usbReceiver) } catch (_: Exception) {}
    }

    // ---------------- Seeds (Port von createPlaygroundProject) ----------------

    private fun seedSetup() = listOf(
        "# Onboard-RGB-LED (WS2812) am ESP32-C3",
        "rgb = RGB(2)",
    ).joinToString("\n")

    private fun seedMain() = listOf(
        "# Blinken — ohne Taster",
        "while True:",
        "    rgb.color(0, 0, 255)   # an (blau)",
        "    sleep_ms(500)",
        "    rgb.off()              # aus",
        "    sleep_ms(500)",
    ).joinToString("\n")

    private fun seedLib() = listOf(
        "# Eigene Funktionen (hier nichts nötig)",
    ).joinToString("\n")
}
