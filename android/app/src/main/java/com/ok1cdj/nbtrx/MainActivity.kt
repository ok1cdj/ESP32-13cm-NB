package com.ok1cdj.nbtrx

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Typeface
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Html
import android.text.method.LinkMovementMethod
import android.view.Gravity
import android.view.WindowInsets
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView

/**
 * One screen: the boards on USB and their permissions, the bridge on or off, "Open in Chrome" for the page on
 * http://localhost:8080, where the page comes from (PageFiles), and about. Plugging a board in brings the app up
 * (USB_DEVICE_ATTACHED) and asks for its permission. Scrolls, and keeps clear of the system bars (edge to edge on Android 15+).
 */
class MainActivity : Activity() {
    private lateinit var info: TextView
    private val ui = Handler(Looper.getMainLooper())
    private val action by lazy { "$packageName.USB_PERMISSION" }

    private val permission = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) { askNext(); refresh() }
    }

    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
        val scroll = ScrollView(this).apply {
            addView(col)
            setOnApplyWindowInsetsListener { _, ins ->
                val b = ins.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                col.setPadding(pad + b.left, pad + b.top, pad + b.right, pad + b.bottom)
                ins
            }
        }
        col.addView(TextView(this).apply { text = "NB 13 cm TRX"; textSize = 22f; setTypeface(typeface, Typeface.BOLD) })
        col.addView(TextView(this).apply {
            text = "USB bridge for the web page: ESP32-S3 receiver and ESP32-C3 transmitter on USB OTG (a powered hub for both), " +
                "the page in Chrome on http://localhost:${BridgeService.PORT}. Transmit only into a dummy load or an attenuator."
            setPadding(0, pad / 2, 0, pad)
        })
        info = TextView(this).apply { typeface = Typeface.MONOSPACE; setPadding(0, 0, 0, pad) }
        col.addView(info)
        fun button(t: String, f: () -> Unit) = col.addView(Button(this).apply { text = t; gravity = Gravity.CENTER; setOnClickListener { f() } })
        button("Allow USB") { askNext() }
        button("Start bridge") { BridgeService.start(this); ui.postDelayed({ refresh() }, 1500) }
        button("Open in Chrome") { openPage() }
        button("Stop bridge") { BridgeService.stop(this); ui.postDelayed({ refresh() }, 300) }
        col.addView(Switch(this).apply {
            text = "Latest page from the web (kept for offline use; off: the kept or built-in copy only)"
            isChecked = PageFiles.online(this@MainActivity)
            setOnCheckedChangeListener { _, on -> PageFiles.setOnline(this@MainActivity, on) }
            setPadding(0, pad, 0, pad / 2)
        })
        col.addView(TextView(this).apply {
            val v = try { packageManager.getPackageInfo(packageName, 0).versionName } catch (_: Exception) { "?" }
            text = Html.fromHtml(
                "<b>About</b><br>NB TRX $v, bridge ${BridgeService.BRIDGE_VERSION}<br>" +
                "Ondřej Koloničný, OK1CDJ · <a href=\"https://ok1cdj.com\">ok1cdj.com</a><br>" +
                "Page: <a href=\"${PageFiles.BASE}\">${PageFiles.BASE}</a><br>" +
                "Source: <a href=\"https://github.com/ok1cdj/ESP32-13cm-NB\">github.com/ok1cdj/ESP32-13cm-NB</a><br>" +
                "Licence GPL-3.0. For licensed radio amateurs: transmit only with your callsign, within your licence and band plan.<br>" +
                "If you like the project: <a href=\"https://buymeacoffee.com/ok1cdj\">Buy Me a Coffee</a> ☕",
                Html.FROM_HTML_MODE_COMPACT)
            movementMethod = LinkMovementMethod.getInstance()
            setPadding(0, pad, 0, 0)
        })
        setContentView(scroll)
        val f = IntentFilter(action)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(permission, f, RECEIVER_NOT_EXPORTED) else registerReceiver(permission, f)
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), 1)
        askNext()
        tick()
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); askNext(); refresh() }   // a board plugged in

    override fun onDestroy() { unregisterReceiver(permission); ui.removeCallbacksAndMessages(null); super.onDestroy() }

    private fun usb() = getSystemService(USB_SERVICE) as UsbManager
    private fun boards() = usb().deviceList.values.filter { it.vendorId == 0x303A && it.productId == 0x1001 }.sortedBy { it.deviceName }

    /** Asks for the permission of the next board that has none (one dialog at a time); when all have it, starts the bridge (again). */
    private fun askNext() {
        val m = usb()
        val missing = boards().firstOrNull { !m.hasPermission(it) }
        if (missing != null) {
            val flags = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
            m.requestPermission(missing, PendingIntent.getBroadcast(this, 0, Intent(action).setPackage(packageName), flags))
        } else if (boards().isNotEmpty()) {
            BridgeService.start(this)                             // starts it, or makes it look for boards plugged in since
        }
    }

    private fun openPage() {
        val uri = Uri.parse("http://localhost:${BridgeService.PORT}/")
        val chrome = Intent(Intent.ACTION_VIEW, uri).setPackage("com.android.chrome")
        try { startActivity(chrome) } catch (_: Exception) { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
    }

    private fun refresh() {
        val m = usb()
        val list = boards().joinToString("\n") { d ->
            val sn = if (m.hasPermission(d)) try { d.serialNumber } catch (_: SecurityException) { null } else null
            "  ${d.deviceName}  ${sn ?: "(no permission yet)"}"
        }.ifEmpty { "  none (303a:1001)" }
        info.text = "ESP32 boards on USB:\n$list\n\nbridge: ${BridgeService.status}\npage: ${PageFiles.lastSource}"
    }

    private fun tick() { refresh(); ui.postDelayed({ tick() }, 1000) }
}
