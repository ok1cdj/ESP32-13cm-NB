package com.ok1cdj.nbtrx

import android.content.Context
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * The files of the page: the latest from the hosted page (GitHub Pages) when the phone is online, kept in the app's files
 * for offline use; else the kept copy; else the one built into the APK (web/ of the repository at build time). So a new
 * page needs no new app; only a change of the bridge does (see [BridgeService.BRIDGE_VERSION]).
 * After a failed fetch the network is not asked again for [RETRY_MS], so an offline page loads at once.
 */
class PageFiles(private val ctx: Context) {
    companion object {
        const val BASE = "https://ok1cdj.github.io/ESP32-13cm-NB/"
        private const val RETRY_MS = 30_000L
        private const val PREFS = "page"
        /** "web": the hosted page first (default); "local": only the kept copy and the built-in one. */
        fun online(ctx: Context) = ctx.getSharedPreferences(PREFS, 0).getBoolean("online", true)
        fun setOnline(ctx: Context, on: Boolean) = ctx.getSharedPreferences(PREFS, 0).edit().putBoolean("online", on).apply()
        /** Where index.html came from last: "web", "kept copy" or "built-in". */
        @Volatile var lastSource = "-"
            private set
    }

    private val kept = File(ctx.filesDir, "web")
    @Volatile private var failedAt = 0L

    /** The file's bytes, or null when no source has it. [rel] is relative to the page, without "..". */
    fun get(rel: String): ByteArray? {
        val (body, src) = fetch(rel)?.let { it to "web" }
            ?: File(kept, rel).takeIf { it.isFile }?.readBytes()?.let { it to "kept copy" }
            ?: builtIn(rel)?.let { it to "built-in" }
            ?: return null
        if (rel == "index.html") lastSource = src
        return body
    }

    private fun fetch(rel: String): ByteArray? {
        if (!online(ctx) || System.currentTimeMillis() - failedAt < RETRY_MS) return null
        return try {
            val c = URL(BASE + rel).openConnection() as HttpURLConnection
            c.connectTimeout = 2000
            c.readTimeout = 4000
            c.useCaches = false
            try {
                if (c.responseCode != 200) return null                 // e.g. a file only the built-in page has
                val b = c.inputStream.use { it.readBytes() }
                val f = File(kept, rel).also { it.parentFile?.mkdirs() }
                File(f.path + ".part").apply { writeBytes(b); renameTo(f) }   // never a half-written copy
                b
            } finally { c.disconnect() }
        } catch (_: IOException) {
            failedAt = System.currentTimeMillis()
            null
        }
    }

    private fun builtIn(rel: String) = try { ctx.assets.open("web/$rel").use { it.readBytes() } } catch (_: IOException) { null }
}
