package com.ok1cdj.nbtrx

import android.content.Context
import org.json.JSONArray
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Is there a newer app? At most once a day (switch off on the screen): the newest release on GitHub against this
 * version, with its notes (the release text is the version's section of CHANGELOG.md). The page needs no check: it
 * comes from the web anyway (PageFiles).
 */
object UpdateCheck {
    private const val PREFS = "updates"
    private const val RELEASES = "https://api.github.com/repos/ok1cdj/ESP32-13cm-NB/releases?per_page=5"
    private const val DAY_MS = 24 * 3600 * 1000L

    class Release(val version: String, val url: String, val notes: String)

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(ctx: Context) = prefs(ctx).getBoolean("enabled", true)
    fun setEnabled(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("enabled", on).apply()
    fun skip(ctx: Context, version: String) = prefs(ctx).edit().putString("skip", version).apply()

    sealed class Outcome {
        object NotNow : Outcome()                              // not time yet (once a day) or switched off
        object Offline : Outcome()
        object UpToDate : Outcome()
        class Newer(val release: Release) : Outcome()
    }

    /** Network, call off the UI thread. [force]: now, and also a version the user chose to skip. */
    fun run(ctx: Context, current: String, force: Boolean = false): Outcome {
        val p = prefs(ctx)
        val now = System.currentTimeMillis()
        if (!force && (!enabled(ctx) || now - p.getLong("last", 0) < DAY_MS)) return Outcome.NotNow
        val r = try { newestRelease() } catch (_: Exception) { null } ?: return Outcome.Offline
        p.edit().putLong("last", now).apply()
        return if (isNewer(r.version, current) && (force || r.version != p.getString("skip", null))) Outcome.Newer(r)
        else Outcome.UpToDate
    }

    private fun newestRelease(): Release? {
        val c = URL(RELEASES).openConnection() as HttpURLConnection
        c.connectTimeout = 8000; c.readTimeout = 15000
        c.setRequestProperty("Accept", "application/vnd.github+json")
        try {
            if (c.responseCode != 200) throw IOException("HTTP ${c.responseCode}")
            val a = JSONArray(c.inputStream.use { it.readBytes() }.toString(Charsets.UTF_8))
            for (i in 0 until a.length()) {
                val r = a.getJSONObject(i)
                if (r.optBoolean("draft") || r.optBoolean("prerelease")) continue
                return Release(r.getString("tag_name").removePrefix("v"), r.getString("html_url"), plain(r.optString("body")))
            }
            return null
        } finally { c.disconnect() }
    }

    /** The release text (Markdown) readable in a dialog: no ** or `, links as their text, "- " as bullets. */
    private fun plain(md: String): String = md.replace("\r", "")
        .replace(Regex("""\n {2,}"""), " ")                          // the wrapped lines of a bullet
        .replace(Regex("""\[([^\]]+)]\([^)]+\)"""), "$1")
        .replace("**", "").replace("`", "")
        .replace(Regex("""(?m)^#+\s*"""), "")
        .replace(Regex("""(?m)^- """), "• ")
        .trim()

    /**
     * "0.4" newer than "0.3"? The leading numbers decide; with the same numbers a release without a suffix is newer than
     * one with. A local build ("0.1-dev") is never told to update; a CI build ("0.3-2-gabc1234-ci") counts as its tag.
     */
    fun isNewer(candidate: String, current: String): Boolean {
        if (current.endsWith("-dev")) return false
        val a = numbers(candidate) ?: return false
        val b = numbers(current.removePrefix("v")) ?: return false
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }; val y = b.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return '-' !in candidate && '-' in current.removePrefix("v")
    }

    private fun numbers(v: String): List<Int>? =
        Regex("""^(\d+(?:\.\d+)*)""").find(v)?.groupValues?.get(1)?.split('.')?.map { it.toInt() }
}
