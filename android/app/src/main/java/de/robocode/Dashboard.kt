package de.robocode

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.view.View
import kotlin.math.cos
import kotlin.math.sin

/**
 * Roadmap 1 — grafisches Terminal / „Armaturentafel" über den LOG-Kanal.
 *
 * Der ESP32 sendet weiter nur Text über die serielle Konsole (`log("DIST:24")`).
 * Die App parst eingehende `NAME:wert`-Zeilen und speist damit vom Kind angelegte
 * Anzeige-Elemente. KEIN neues Protokoll — dieselbe USB-CDC-Ausgabe wie im
 * Text-Terminal; unbekannte Namen bleiben dort sichtbar.
 */
enum class WidgetType(val code: String, val label: String) {
    GAU("GAU", "Zeiger"),
    BAR("BAR", "Balken"),
    TXT("TXT", "Text"),
    LED("LED", "Lampe"),
    OSZ("OSZ", "Oszilloskop");

    companion object {
        fun from(code: String): WidgetType = entries.firstOrNull { it.code.equals(code, true) } ?: TXT
    }
}

/**
 * Ein Tafel-Element. [name] ist der LOG-Schlüssel (z. B. `DIST`), [min]/[max] der
 * erwartete Wertebereich für Zeiger/Balken/Oszilloskop. Beim Oszilloskop hält
 * [name] mehrere Kanäle, mit Komma getrennt (z. B. `ax,ay`). Pro Projekt gespeichert.
 */
data class Widget(
    var id: String,
    var type: WidgetType,
    var name: String,
    var min: Double = 0.0,
    var max: Double = 100.0,
) {
    /** LOG-Namen, auf die dieses Widget hört. Oszilloskop: mehrere (Komma). */
    fun channels(): List<String> =
        if (type == WidgetType.OSZ) name.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        else listOf(name)
}

fun newWidgetId(): String = "w_" + System.currentTimeMillis().toString(36) + "_" + (0..9999).random()

/**
 * Zeichnet ein einzelnes Tafel-Element (Zeiger/Balken/Text/Lampe) per Canvas und
 * hält eine kurze Wert-History für die Mini-Kurve. [feed] nimmt den rohen Wert aus
 * der Logzeile; die Redraw-Rate ist gedrosselt (bei viel Traffic nicht jeder Wert
 * ein eigener Frame).
 */
class DashWidgetView(context: Context, val widget: Widget) : View(context) {

    private var value: Double? = null
    private var textValue: String? = null
    private val history = ArrayDeque<Float>()
    // Oszilloskop: je Kanal (GROSS-Name) eine eigene Wert-History.
    private val oszHist = LinkedHashMap<String, ArrayDeque<Float>>()

    private val d = resources.displayMetrics.density
    private fun dp(v: Float) = v * d

    private val pLabel = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = LABEL; textSize = dp(11f) }
    private val pValue = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = VALUE; textSize = dp(22f); typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    }
    private val pTrack = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = TRACK; style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val pAccent = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ACCENT; style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val pFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ACCENT; style = Paint.Style.FILL }
    private val pCard = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = CARD; style = Paint.Style.FILL }
    private val pSpark = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = SPARK; style = Paint.Style.STROKE; strokeWidth = dp(1.5f) }

    private var pending = false
    private val flush = Runnable { pending = false; invalidate() }

    /** Rohen Logwert eines Kanals übernehmen; [num] ist die geparste Zahl (oder
     *  null für Text). [channel] ist der LOG-Name (für das Oszilloskop relevant). */
    fun feed(channel: String, raw: String, num: Double?) {
        when (widget.type) {
            WidgetType.TXT -> textValue = raw
            WidgetType.LED -> value = if (isOn(raw, num)) 1.0 else 0.0
            WidgetType.OSZ -> {
                if (num == null) return
                val h = oszHist.getOrPut(channel.uppercase()) { ArrayDeque() }
                h.addLast(num.toFloat())
                while (h.size > OSZ_HIST) h.removeFirst()
            }
            else -> {
                if (num == null) return
                value = num
                history.addLast(num.toFloat())
                while (history.size > MAX_HIST) history.removeFirst()
            }
        }
        throttledInvalidate()
    }

    private fun isOn(raw: String, num: Double?): Boolean =
        num?.let { it != 0.0 } ?: (raw.trim().lowercase() in ON_WORDS)

    private fun throttledInvalidate() {
        if (pending) return
        pending = true
        postDelayed(flush, 80) // koalesziert Bursts auf ~12 fps
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec)
        val h = dp(
            when (widget.type) {
                WidgetType.GAU -> 150f
                WidgetType.BAR -> 92f
                WidgetType.LED -> 78f
                WidgetType.TXT -> 70f
                WidgetType.OSZ -> 180f
            },
        ).toInt()
        setMeasuredDimension(w, h)
    }

    override fun onDraw(c: Canvas) {
        val pad = dp(8f)
        val card = RectF(pad, pad, width - pad, height - pad)
        c.drawRoundRect(card, dp(10f), dp(10f), pCard)

        val left = card.left + dp(10f)
        val top = card.top + dp(8f)
        // Oszilloskop zeichnet eine farbige Kanal-Legende statt des reinen Namens.
        if (widget.type != WidgetType.OSZ) c.drawText(widget.name, left, top + pLabel.textSize, pLabel)
        if (widget.type == WidgetType.GAU || widget.type == WidgetType.BAR || widget.type == WidgetType.OSZ) {
            val range = "${fmt(widget.min)}…${fmt(widget.max)}"
            c.drawText(range, card.right - dp(10f) - pLabel.measureText(range), top + pLabel.textSize, pLabel)
        }

        when (widget.type) {
            WidgetType.GAU -> drawGauge(c, card)
            WidgetType.BAR -> drawBar(c, card)
            WidgetType.TXT -> drawText(c, card)
            WidgetType.LED -> drawLed(c, card)
            WidgetType.OSZ -> drawOsz(c, card)
        }
    }

    /** Oszilloskop: Gitter + je Kanal eine farbige Kurve, oben eine Legende. */
    private fun drawOsz(c: Canvas, card: RectF) {
        val x0 = card.left + dp(10f); val x1 = card.right - dp(10f)
        val y0 = card.top + dp(30f); val y1 = card.bottom - dp(10f)
        // Gitter
        val grid = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = TRACK; strokeWidth = dp(1f) }
        for (i in 0..4) { val gy = y0 + (y1 - y0) * i / 4f; c.drawLine(x0, gy, x1, gy, grid) }

        val lo = widget.min.toFloat(); val hi = widget.max.toFloat()
        val span = if (hi > lo) hi - lo else 1f
        var legendX = x0
        val baseline = card.top + dp(8f) + pLabel.textSize
        widget.channels().forEachIndexed { ci, ch ->
            val col = CH_COLORS[ci % CH_COLORS.size]
            pLabel.color = col
            c.drawText(ch, legendX, baseline, pLabel)
            legendX += pLabel.measureText(ch) + dp(12f)
            val h = oszHist[ch.uppercase()]
            if (h != null && h.size >= 2) {
                val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = col; style = Paint.Style.STROKE; strokeWidth = dp(1.6f); strokeCap = Paint.Cap.ROUND
                }
                val n = h.size; var px = 0f; var py = 0f
                h.forEachIndexed { i, v ->
                    val fx = x0 + (x1 - x0) * (i.toFloat() / (n - 1))
                    val norm = ((v - lo) / span).coerceIn(0f, 1f)
                    val fy = y1 - (y1 - y0) * norm
                    if (i > 0) c.drawLine(px, py, fx, fy, line)
                    px = fx; py = fy
                }
            }
        }
        pLabel.color = LABEL
    }

    private fun drawGauge(c: Canvas, card: RectF) {
        val cx = card.centerX()
        val cy = card.top + dp(40f) + dp(48f)
        val r = dp(44f)
        val arc = RectF(cx - r, cy - r, cx + r, cy + r)
        pTrack.strokeWidth = dp(9f); pAccent.strokeWidth = dp(9f)
        c.drawArc(arc, 180f, 180f, false, pTrack)
        val f = frac()
        if (f > 0f) c.drawArc(arc, 180f, 180f * f, false, pAccent)
        // Zeiger
        val a = Math.toRadians((180.0 + 180.0 * f))
        c.drawLine(cx, cy, cx + (r * 0.92f) * cos(a).toFloat(), cy + (r * 0.92f) * sin(a).toFloat(), pFill.also { it.strokeWidth = dp(3f); it.style = Paint.Style.STROKE })
        pFill.style = Paint.Style.FILL
        c.drawCircle(cx, cy, dp(4f), pFill)
        c.drawText(valueText(), cx - pValue.measureText(valueText()) / 2f, cy + dp(28f), pValue)
        drawSpark(c, card.left + dp(10f), card.bottom - dp(20f), card.right - dp(10f), card.bottom - dp(8f))
    }

    private fun drawBar(c: Canvas, card: RectF) {
        val bx0 = card.left + dp(10f)
        val bx1 = card.right - dp(10f)
        val by = card.top + dp(40f)
        val h = dp(14f)
        val track = RectF(bx0, by, bx1, by + h)
        c.drawRoundRect(track, h / 2f, h / 2f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = TRACK })
        val f = frac()
        if (f > 0f) {
            val fill = RectF(bx0, by, bx0 + (bx1 - bx0) * f, by + h)
            c.drawRoundRect(fill, h / 2f, h / 2f, pFill)
        }
        val vt = valueText()
        c.drawText(vt, bx1 - pValue.measureText(vt), by + h + dp(26f), pValue)
        drawSpark(c, bx0, card.bottom - dp(20f), bx1, card.bottom - dp(8f))
    }

    private fun drawText(c: Canvas, card: RectF) {
        val t = textValue ?: "—"
        pValue.textSize = dp(24f)
        c.drawText(t, card.left + dp(10f), card.centerY() + dp(18f), pValue)
    }

    private fun drawLed(c: Canvas, card: RectF) {
        val on = (value ?: 0.0) != 0.0
        val cx = card.left + dp(28f)
        val cy = card.centerY() + dp(6f)
        c.drawCircle(cx, cy, dp(16f), Paint(Paint.ANTI_ALIAS_FLAG).apply { color = if (on) ACCENT else TRACK })
        pValue.textSize = dp(18f)
        c.drawText(if (on) "AN" else "aus", cx + dp(28f), cy + dp(7f), pLabel.also { it.textSize = dp(16f); it.color = if (on) VALUE else LABEL })
        pLabel.textSize = dp(11f); pLabel.color = LABEL
    }

    /** Mini-Kurve der letzten Werte über den Widget-Bereich skaliert. */
    private fun drawSpark(c: Canvas, x0: Float, y0: Float, x1: Float, y1: Float) {
        if (history.size < 2) return
        val lo = widget.min.toFloat(); val hi = widget.max.toFloat()
        val span = if (hi > lo) hi - lo else 1f
        val n = history.size
        var prevX = 0f; var prevY = 0f
        history.forEachIndexed { i, v ->
            val fx = x0 + (x1 - x0) * (i.toFloat() / (n - 1))
            val norm = ((v - lo) / span).coerceIn(0f, 1f)
            val fy = y1 - (y1 - y0) * norm
            if (i > 0) c.drawLine(prevX, prevY, fx, fy, pSpark)
            prevX = fx; prevY = fy
        }
    }

    private fun frac(): Float {
        val v = value ?: return 0f
        val lo = widget.min; val hi = widget.max
        if (hi <= lo) return 0f
        return ((v - lo) / (hi - lo)).toFloat().coerceIn(0f, 1f)
    }

    private fun valueText(): String = value?.let { fmt(it) } ?: "—"

    private fun fmt(v: Double): String =
        if (v == v.toLong().toDouble()) v.toLong().toString() else String.format("%.1f", v)

    companion object {
        private const val MAX_HIST = 48
        private const val OSZ_HIST = 120
        private val ON_WORDS = setOf("on", "an", "ein", "true", "high", "1", "yes", "ja")
        private val CARD = 0xFF1B2029.toInt()
        private val TRACK = 0xFF2A3340.toInt()
        private val ACCENT = 0xFF2ECC71.toInt()
        private val LABEL = 0xFF8A93A2.toInt()
        private val VALUE = 0xFFE6E9EF.toInt()
        private val SPARK = 0xFF5A8DEE.toInt()
        // Kanalfarben fürs Oszilloskop.
        private val CH_COLORS = intArrayOf(
            0xFF2ECC71.toInt(), 0xFF5A8DEE.toInt(), 0xFFE67E22.toInt(),
            0xFFE74C3C.toInt(), 0xFF9B59B6.toInt(), 0xFF1ABC9C.toInt(),
        )
    }
}
