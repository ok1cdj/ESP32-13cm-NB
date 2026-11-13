package com.ok1cdj.nbtrx

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/**
 * The bridge, a foreground service: the boards on USB (303a:1001, the S3 receiver and the C3 transmitter, told apart by
 * asking them "CAPS": ESP-SDR answers CAPS, the C3's cw-beacon an ERR with its commands, which does not switch its beacon
 * off) and the page's server on 127.0.0.1:[PORT]. A WebSocket on /serial/s3 or /serial/c3 gets that board's bytes both ways;
 * a new one replaces the old. The bytes are passed on unchanged: the page speaks to the boards as it does over Web Serial.
 * A board plugged in later is added when the activity starts the service again (after its permission); one unplugged is dropped.
 */
class BridgeService : Service() {
    companion object {
        const val PORT = 8080
        /** In /bridge.json: the page asks for a newer app when it needs a newer bridge (tools/web_bridge.py says the same). */
        const val BRIDGE_VERSION = 1
        @Volatile var status: String = "stopped"
            private set
        @Volatile var running = false
            private set
        fun start(ctx: Context) = ctx.startForegroundService(Intent(ctx, BridgeService::class.java))
        fun stop(ctx: Context) = ctx.stopService(Intent(ctx, BridgeService::class.java))
    }

    private class Board(val role: String, val dev: UsbDevice, val cdc: UsbCdc) {
        @Volatile var client: WsConnection? = null
        @Volatile var pumping = false
        @Volatile var alive = true
    }

    private val boards = ConcurrentHashMap<String, Board>()
    private var server: WebServer? = null
    private var wake: PowerManager.WakeLock? = null

    private val detached = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            @Suppress("DEPRECATION") val dev = i.getParcelableExtra<UsbDevice>(UsbManager.EXTRA_DEVICE) ?: return
            for (b in boards.values.filter { it.dev.deviceName == dev.deviceName }) drop(b)
            setStatus(summary())
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // connectedDevice only with a board that has its permission (Android 14+ refuses it otherwise): else the page alone
        val m = getSystemService(USB_SERVICE) as UsbManager
        val usb = m.deviceList.values.any { it.vendorId == 0x303A && it.productId == 0x1001 && m.hasPermission(it) }
        startForeground(1, notification("starting"),
            if (usb) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        if (!running) {
            running = true
            wake = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "nbtrx:bridge").apply { acquire() }
            registerReceiver(detached, IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED))
            Thread({ bringUp() }, "bridge-up").start()
        } else {
            Thread({ scan(); setStatus(summary()) }, "bridge-scan").start()          // started again: boards plugged in since
        }
        return START_NOT_STICKY
    }

    private fun bringUp() {
        scan()
        try {
            val page = PageFiles(this)
            server = WebServer(page::get, PORT, ::bridgeJson, ::attach).also { it.start() }
        } catch (e: IOException) {
            setStatus("server on port $PORT: ${e.message}")
            return
        }
        setStatus(summary())
    }

    /** Opens and identifies the permitted boards the bridge does not have yet. */
    @Synchronized private fun scan() {
        val m = getSystemService(USB_SERVICE) as UsbManager
        val have = boards.values.map { it.dev.deviceName }
        for (dev in m.deviceList.values.filter { it.vendorId == 0x303A && it.productId == 0x1001 && m.hasPermission(it) && it.deviceName !in have }) {
            try {
                val conn = m.openDevice(dev) ?: continue
                val cdc = UsbCdc(conn, dev)
                val role = identify(cdc)
                if (role == null || boards.containsKey(role)) { cdc.close(); continue }
                boards[role] = Board(role, dev, cdc)
            } catch (e: IOException) {
                setStatus("USB: ${e.message}")
            }
        }
    }

    /** An unplugged board: its page socket closed (the page sees the port lost), its reader stopped. */
    private fun drop(b: Board) {
        boards.remove(b.role, b)
        b.alive = false
        b.client?.close()
        if (!b.pumping) try { b.cdc.close() } catch (_: Exception) { }
    }

    private fun summary() =
        "http://localhost:$PORT  –  S3 ${if (boards.containsKey("s3")) "ready" else "missing"}, C3 ${if (boards.containsKey("c3")) "ready" else "missing"}"

    /** "s3", "c3" or null: an empty line first (it stops a stream left running on the S3), then CAPS. */
    private fun identify(cdc: UsbCdc): String? {
        val buf = ByteArray(16384)
        cdc.write("\n".toByteArray())
        Thread.sleep(400)
        while (cdc.read(buf, 50) > 0) { }                         // what the stopped stream left behind
        repeat(2) {
            cdc.write("CAPS\n".toByteArray())
            val sb = StringBuilder()
            val t0 = System.currentTimeMillis()
            while (System.currentTimeMillis() - t0 < 1200) {
                val n = cdc.read(buf, 100)
                if (n > 0) sb.append(String(buf, 0, n, Charsets.ISO_8859_1))
                if (sb.contains("CAPS ")) return "s3"
                if (sb.contains("commands: INFO")) return "c3"
            }
        }
        return null
    }

    private fun bridgeJson(): String = JSONObject()
        .put("version", BRIDGE_VERSION).put("s3", "/serial/s3").put("c3", "/serial/c3")
        .put("ports", JSONObject().apply { for ((r, b) in boards) put(r, "USB ${b.dev.deviceName} ${serialOf(b.dev)}") })
        .toString()

    private fun serialOf(d: UsbDevice) = try { d.serialNumber ?: "" } catch (_: SecurityException) { "" }

    /** A WebSocket for a board: page -> board on this thread, board -> page on a reader thread. */
    private fun attach(path: String, ws: WsConnection) {
        val b = boards[path.removePrefix("/serial/")]
        if (b == null) { ws.close(); return }
        b.client?.close()                                         // a new page takes the board over
        b.client = ws
        setStatus("page on ${b.role.uppercase()}")
        synchronized(b) {
            if (!b.pumping) {
                b.pumping = true
                Thread({
                    try {
                        b.cdc.readLoop({ running && b.alive }) { arr, n -> b.client?.send(arr, n) }
                    } catch (e: IOException) {
                        if (b.alive) setStatus("${b.role.uppercase()}: ${e.message}")
                    } finally {
                        b.pumping = false
                        if (!b.alive) try { b.cdc.close() } catch (_: Exception) { }
                    }
                }, "usb-${b.role}").start()
            }
        }
        try {
            while (true) {
                val data = ws.read() ?: break
                if (data.isNotEmpty()) b.cdc.write(data)
            }
        } catch (e: IOException) {
            setStatus("${b.role.uppercase()} write: ${e.message}")
        } finally {
            ws.close()
            if (b.client === ws) b.client = null
        }
    }

    private fun setStatus(s: String) {
        status = s
        getSystemService(NotificationManager::class.java).notify(1, notification(s))
    }

    private fun notification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("bridge", "USB bridge", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, "bridge")
            .setSmallIcon(R.drawable.ic_stat_nb)
            .setContentTitle("NB TRX bridge")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        if (running) unregisterReceiver(detached)
        running = false
        server?.stop()
        for (b in boards.values) { b.client?.close(); try { b.cdc.close() } catch (_: Exception) { } }
        boards.clear()
        wake?.release()
        status = "stopped"
        super.onDestroy()
    }
}
