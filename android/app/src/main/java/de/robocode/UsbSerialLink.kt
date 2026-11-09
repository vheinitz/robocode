package de.robocode

import android.content.Context
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import com.hoho.android.usbserial.driver.CdcAcmSerialDriver
import com.hoho.android.usbserial.driver.ProbeTable
import com.hoho.android.usbserial.driver.UsbSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber

/**
 * USB-OTG-Verbindung zum ESP32 für den Flash-Vorgang.
 *
 * Nutzt `usb-serial-for-android` (CDC-ACM). Ein ESP32-C3/S3 meldet sich über
 * sein natives USB-Serial/JTAG mit VID:PID 303A:1001 – diese Kennung steht
 * NICHT in der Standardliste des Default-Probers und wird hier über eine eigene
 * ProbeTable auf den CdcAcmSerialDriver gelegt; als Rückfall dient der
 * Default-Prober (CP2102, CH340, FTDI).
 *
 * Stellt rohen Byte-Zugriff bereit und implementiert [EspLoader.Io], damit der
 * Protokoll-Client SLIP-Frames direkt schreiben/lesen kann. Die USB-Berechtigung
 * muss vor [open] erteilt sein.
 */
class UsbSerialLink(context: Context) : EspLoader.Io {

    private val manager = context.getSystemService(Context.USB_SERVICE) as UsbManager
    private var port: UsbSerialPort? = null

    val isOpen: Boolean get() = port != null

    /** Erstes passendes USB-Serial-Gerät (eigene Kennung zuerst, dann Standard). */
    fun findDriver(): UsbSerialDriver? {
        customProber.findAllDrivers(manager).firstOrNull()?.let { return it }
        return UsbSerialProber.getDefaultProber().findAllDrivers(manager).firstOrNull()
    }

    fun hasPermission(device: UsbDevice): Boolean = manager.hasPermission(device)

    /** Gerät öffnen (Berechtigung muss vorliegen). true bei Erfolg. */
    fun open(driver: UsbSerialDriver, baudRate: Int = 115200): Boolean {
        val connection = manager.openDevice(driver.device) ?: return false
        val p = driver.ports.first()
        p.open(connection)
        p.setParameters(baudRate, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
        // DTR/RTS aktiv – beim nativen USB des C3/S3 unkritisch; schadet nicht.
        try { p.dtr = true } catch (_: Exception) {}
        try { p.rts = true } catch (_: Exception) {}
        port = p
        return true
    }

    fun close() {
        try { port?.close() } catch (_: Exception) {}
        port = null
    }

    // ---------------- EspLoader.Io ----------------

    override fun writeRaw(data: ByteArray) {
        try { port?.write(data, WRITE_TIMEOUT_MS) } catch (_: Exception) {}
    }

    override fun readRaw(buf: ByteArray, timeoutMs: Int): Int =
        try { port?.read(buf, timeoutMs) ?: -1 } catch (_: Exception) { -1 }

    override fun purge() {
        try { port?.purgeHwBuffers(true, true) } catch (_: Exception) {}
    }

    companion object {
        private const val WRITE_TIMEOUT_MS = 3000

        /** Eigene Kennung des ESP32-C3/S3 (natives USB-Serial/JTAG). */
        private val customProber: UsbSerialProber by lazy {
            val table = ProbeTable()
            table.addProduct(0x303A, 0x1001, CdcAcmSerialDriver::class.java)
            UsbSerialProber(table)
        }
    }
}
