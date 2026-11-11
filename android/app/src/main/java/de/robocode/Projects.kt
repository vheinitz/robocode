package de.robocode

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Projekt-Datensatz (nativer Gegenpart zu src/model/project.ts). Ein Projekt
 * hält die drei Code-Container (SETUP/MAIN/LIB), das gewählte Board und eine
 * eigene Pin-Belegung (0.2; null = Board-Standard).
 */
data class RoboProject(
    var id: String,
    var name: String,
    var boardId: String,
    var pins: MutableList<PinDesc>?,
    var setup: String,
    var main: String,
    var lib: String,
    // Roadmap 1: grafische Tafel (Widgets über den LOG-Kanal) je Projekt.
    var dashboard: MutableList<Widget> = mutableListOf(),
)

/**
 * Mehr-Projekt-Ablage (0.1) in SharedPreferences: ein Index (id+Name), je
 * Projekt ein JSON-Datensatz und die ID des aktuellen Projekts. Bewusst lokal,
 * kein Backend — Projekte überleben Neustart der App.
 */
object ProjectStore {
    private const val PREF = "robocode.projects"
    private const val KEY_INDEX = "index"
    private const val KEY_CURRENT = "current"
    private fun prefs(c: Context) = c.getSharedPreferences(PREF, Context.MODE_PRIVATE)
    private fun projKey(id: String) = "project.$id"

    data class Info(val id: String, val name: String)

    fun newId(): String = "prj_" + System.currentTimeMillis().toString(36) + "_" + (0..9999).random()

    fun list(c: Context): List<Info> {
        val raw = prefs(c).getString(KEY_INDEX, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { val o = arr.getJSONObject(it); Info(o.getString("id"), o.getString("name")) }
        } catch (_: Exception) { emptyList() }
    }

    private fun writeIndex(c: Context, list: List<Info>) {
        val arr = JSONArray()
        for (i in list) arr.put(JSONObject().put("id", i.id).put("name", i.name))
        prefs(c).edit().putString(KEY_INDEX, arr.toString()).apply()
    }

    fun load(c: Context, id: String): RoboProject? {
        val raw = prefs(c).getString(projKey(id), null) ?: return null
        return try { fromJson(JSONObject(raw)) } catch (_: Exception) { null }
    }

    /** Datensatz speichern und im Index nach vorn (zuletzt genutzt) sortieren. */
    fun save(c: Context, p: RoboProject) {
        prefs(c).edit().putString(projKey(p.id), toJson(p).toString()).apply()
        val list = list(c).filter { it.id != p.id }.toMutableList()
        list.add(0, Info(p.id, p.name))
        writeIndex(c, list)
    }

    fun delete(c: Context, id: String) {
        prefs(c).edit().remove(projKey(id)).apply()
        writeIndex(c, list(c).filter { it.id != id })
    }

    fun currentId(c: Context): String? = prefs(c).getString(KEY_CURRENT, null)
    fun setCurrent(c: Context, id: String) { prefs(c).edit().putString(KEY_CURRENT, id).apply() }

    private fun toJson(p: RoboProject): JSONObject {
        val o = JSONObject().put("id", p.id).put("name", p.name).put("boardId", p.boardId)
            .put("setup", p.setup).put("main", p.main).put("lib", p.lib)
        p.pins?.let { pins ->
            val arr = JSONArray()
            for (pin in pins) arr.put(
                JSONObject().put("gpio", pin.gpio).put("name", pin.name)
                    .put("role", pin.role.name).put("adc", pin.adc)
                    .put("note", pin.note ?: JSONObject.NULL),
            )
            o.put("pins", arr)
        }
        if (p.dashboard.isNotEmpty()) {
            val arr = JSONArray()
            for (w in p.dashboard) arr.put(
                JSONObject().put("id", w.id).put("type", w.type.code)
                    .put("name", w.name).put("min", w.min).put("max", w.max),
            )
            o.put("dashboard", arr)
        }
        return o
    }

    private fun fromJson(o: JSONObject): RoboProject {
        val pins: MutableList<PinDesc>? = if (o.has("pins") && !o.isNull("pins")) {
            val arr = o.getJSONArray("pins")
            (0 until arr.length()).map {
                val po = arr.getJSONObject(it)
                PinDesc(
                    po.getInt("gpio"), po.getString("name"),
                    runCatching { PinRole.valueOf(po.getString("role")) }.getOrDefault(PinRole.NONE),
                    po.optBoolean("adc", false),
                    if (po.isNull("note")) null else po.optString("note"),
                )
            }.toMutableList()
        } else null
        val dashboard: MutableList<Widget> = if (o.has("dashboard") && !o.isNull("dashboard")) {
            val arr = o.getJSONArray("dashboard")
            (0 until arr.length()).map {
                val wo = arr.getJSONObject(it)
                Widget(
                    wo.optString("id", newWidgetId()),
                    WidgetType.from(wo.optString("type", "TXT")),
                    wo.optString("name", ""),
                    wo.optDouble("min", 0.0), wo.optDouble("max", 100.0),
                )
            }.toMutableList()
        } else mutableListOf()
        return RoboProject(
            o.getString("id"), o.getString("name"),
            o.optString("boardId", Boards.ALL[0].id), pins,
            o.optString("setup", ""), o.optString("main", ""), o.optString("lib", ""),
            dashboard,
        )
    }
}
