package com.ok1cdj.nbtrx

import android.content.res.AssetManager
import android.util.Base64
import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest

/**
 * The page's server on 127.0.0.1, as tools/web_bridge.py on the PC: plain HTTP for the files of web/ (from the APK's assets)
 * and /bridge.json, and WebSocket (RFC 6455, binary frames) for /serial/s3 and /serial/c3, which [onSocket] connects to a board.
 * Small on purpose: GET only, one request per connection, no TLS (the browser treats localhost as a secure context).
 */
class WebServer(
    private val assets: AssetManager,
    private val port: Int,
    private val bridgeJson: () -> String,
    private val onSocket: (path: String, ws: WsConnection) -> Unit,
) {
    private var server: ServerSocket? = null
    @Volatile private var running = false

    fun start() {
        val s = ServerSocket(port, 16, InetAddress.getByName("127.0.0.1")).apply { reuseAddress = true }
        server = s
        running = true
        Thread({
            while (running) {
                val c = try { s.accept() } catch (_: IOException) { break }
                Thread({ serve(c) }, "http").start()
            }
        }, "http-accept").start()
    }

    fun stop() {
        running = false
        try { server?.close() } catch (_: IOException) { }
    }

    private fun serve(sock: Socket) {
        try {
            sock.tcpNoDelay = true
            val inp = BufferedInputStream(sock.getInputStream())
            val out = sock.getOutputStream()
            val lines = readHead(inp) ?: return sock.close()
            val req = lines[0].split(" ")
            if (req.size < 2 || req[0] != "GET") return reply(out, 405, "text/plain", "GET only\n".toByteArray(), sock)
            val path = req[1].substringBefore('?')
            val headers = lines.drop(1).mapNotNull { l -> l.indexOf(':').takeIf { it > 0 }?.let { l.substring(0, it).trim().lowercase() to l.substring(it + 1).trim() } }.toMap()
            val key = headers["sec-websocket-key"]
            if (key != null && headers["upgrade"]?.lowercase() == "websocket") {
                val accept = Base64.encodeToString(
                    MessageDigest.getInstance("SHA-1").digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray()), Base64.NO_WRAP)
                out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: $accept\r\n\r\n").toByteArray())
                out.flush()
                onSocket(path, WsConnection(sock, inp, out))
                return
            }
            if (path == "/bridge.json") return reply(out, 200, "application/json", bridgeJson().toByteArray(), sock)
            val rel = if (path == "/" || path.isEmpty()) "index.html" else path.trimStart('/')
            if (rel.contains("..")) return reply(out, 404, "text/plain", "not found\n".toByteArray(), sock)
            val body = try { assets.open("web/$rel").use { it.readBytes() } } catch (_: IOException) {
                return reply(out, 404, "text/plain", "not found\n".toByteArray(), sock)
            }
            reply(out, 200, mime(rel), body, sock)
        } catch (_: IOException) {
            try { sock.close() } catch (_: IOException) { }
        }
    }

    private fun readHead(inp: InputStream): List<String>? {
        val lines = mutableListOf<String>()
        val sb = StringBuilder()
        while (true) {
            val c = inp.read()
            if (c < 0) return null
            if (c == '\n'.code) {
                val l = sb.toString().trimEnd('\r')
                sb.setLength(0)
                if (l.isEmpty()) return if (lines.isEmpty()) null else lines
                lines += l
                if (lines.size > 100) return null
            } else if (sb.length < 8192) sb.append(c.toChar())
        }
    }

    private fun reply(out: OutputStream, code: Int, type: String, body: ByteArray, sock: Socket) {
        val reason = mapOf(200 to "OK", 404 to "Not Found", 405 to "Method Not Allowed")[code] ?: "Error"
        out.write(("HTTP/1.1 $code $reason\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").toByteArray())
        out.write(body)
        out.flush()
        sock.close()
    }

    private fun mime(p: String) = when (p.substringAfterLast('.', "")) {
        "html" -> "text/html; charset=utf-8"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json" -> "application/json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        else -> "application/octet-stream"
    }
}

/** One WebSocket connection: [read] gives the payload of the next data frame (null when closed); [send] a binary frame. */
class WsConnection(private val sock: Socket, private val inp: InputStream, private val out: OutputStream) {
    @Volatile var closed = false
        private set

    fun read(): ByteArray? {
        while (!closed) {
            val b0 = inp.read()
            val b1 = inp.read()
            if (b0 < 0 || b1 < 0) { close(); return null }
            val op = b0 and 0x0F
            var len = (b1 and 0x7F).toLong()
            if (len == 126L) len = ((inp.read() shl 8) or inp.read()).toLong()
            else if (len == 127L) { len = 0; repeat(8) { len = (len shl 8) or inp.read().toLong() } }
            val mask = if (b1 and 0x80 != 0) ByteArray(4).also { readFully(it) } else null
            if (len > 1 shl 24) { close(); return null }
            val data = ByteArray(len.toInt()).also { readFully(it) }
            if (mask != null) for (i in data.indices) data[i] = (data[i].toInt() xor mask[i and 3].toInt()).toByte()
            when (op) {
                0x1, 0x2, 0x0 -> return data                        // text, binary, continuation: the bytes either way
                0x8 -> { frame(0x8, ByteArray(0)); close(); return null }
                0x9 -> frame(0xA, data)                             // ping -> pong
            }
        }
        return null
    }

    fun send(b: ByteArray, n: Int = b.size) {
        if (!closed) try { frame(0x2, b, n) } catch (_: IOException) { close() }
    }

    @Synchronized private fun frame(op: Int, b: ByteArray, n: Int = b.size) {
        val head = when {
            n < 126 -> byteArrayOf((0x80 or op).toByte(), n.toByte())
            n < 65536 -> byteArrayOf((0x80 or op).toByte(), 126, (n shr 8).toByte(), n.toByte())
            else -> ByteArray(10).also { h -> h[0] = (0x80 or op).toByte(); h[1] = 127; for (i in 0 until 8) h[9 - i] = (n.toLong() shr (8 * i)).toByte() }
        }
        out.write(head)
        out.write(b, 0, n)
        out.flush()
    }

    private fun readFully(b: ByteArray) {
        var o = 0
        while (o < b.size) {
            val r = inp.read(b, o, b.size - o)
            if (r < 0) throw IOException("closed")
            o += r
        }
    }

    fun close() {
        if (closed) return
        closed = true
        try { sock.close() } catch (_: IOException) { }
    }
}
