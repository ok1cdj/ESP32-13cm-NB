#!/usr/bin/env python3
"""web_bridge.py: serve the web receiver (web/) and pass the boards' serial ports to it over WebSocket.

    tools/web_bridge.py                 (then http://localhost:8080 in any browser)
    tools/web_bridge.py --port 8081

The page talks to the boards through this bridge when it is served by it (it asks /bridge.json), in any browser. (Web Serial
in Chrome on Linux fails on a port that pyserial, esptool or idf.py monitor used last: they leave VMIN = 0, Chrome's first read
returns 0 bytes and it reports "The device has been lost"; see nbports.tty_release.)
ws://localhost:PORT/serial/s3 and /serial/c3 carry the raw bytes both ways (ports from tools/nbports.py). One client per board:
a new connection replaces the old one. Listens on 127.0.0.1 only.
"""
import argparse
import asyncio
import json
import mimetypes
import os
import sys
import threading

import serial
from websockets.asyncio.server import serve
from websockets.datastructures import Headers
from websockets.http11 import Response

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nbports import RX_PORT, TX_PORT, tty_release  # noqa: E402

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
BOARDS = {"/serial/s3": RX_PORT, "/serial/c3": TX_PORT}
active = {}                                                    # path -> the connection that has the board


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def process_request(conn, request):
    """Plain HTTP: the page's files and /bridge.json; the serial paths go on to the WebSocket handler."""
    path = request.path.split("?")[0]
    if path in BOARDS:
        return None
    if path == "/bridge.json":
        body = json.dumps({"version": 1, "s3": "/serial/s3", "c3": "/serial/c3", "ports": {"s3": RX_PORT, "c3": TX_PORT}}).encode()
        return Response(200, "OK", Headers([("Content-Type", "application/json"), ("Content-Length", str(len(body))),
                                            ("Cache-Control", "no-store")]), body)
    rel = "index.html" if path in ("/", "") else path.lstrip("/")
    full = os.path.realpath(os.path.join(WEB, rel))
    if not full.startswith(os.path.realpath(WEB) + os.sep) or not os.path.isfile(full):
        return conn.respond(404, "not found\n")
    with open(full, "rb") as f:
        body = f.read()
    ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
    if full.endswith((".js", ".mjs")):
        ctype = "text/javascript"
    return Response(200, "OK", Headers([("Content-Type", ctype), ("Content-Length", str(len(body))), ("Cache-Control", "no-store")]), body)


async def handler(ws):
    path = ws.request.path.split("?")[0]
    dev = BOARDS[path]
    old = active.get(path)
    if old is not None:
        log(path, "taken over by a new client")
        await old.close(1000, "another client")
    active[path] = ws
    try:
        ser = serial.Serial(dev, 115200, timeout=0.01, write_timeout=2)
    except serial.SerialException as e:
        log(path, "cannot open", dev, e)
        await ws.close(1011, str(e)[:100])
        return
    log(path, "open", dev)
    loop = asyncio.get_running_loop()
    stop = threading.Event()

    def reader():                                              # serial -> WebSocket, in batches of what has arrived
        while not stop.is_set():
            try:
                d = ser.read(16384)
            except serial.SerialException as e:
                log(path, "read:", e)
                asyncio.run_coroutine_threadsafe(ws.close(1011, "serial read error"), loop)
                return
            if d:
                asyncio.run_coroutine_threadsafe(ws.send(d), loop)

    t = threading.Thread(target=reader, daemon=True)
    t.start()
    try:
        async for msg in ws:                                   # WebSocket -> serial
            ser.write(msg if isinstance(msg, bytes) else msg.encode())
    except Exception as e:                                     # noqa: BLE001  (a closed socket ends the session either way)
        log(path, "closed:", e)
    finally:
        stop.set()
        t.join(1)
        tty_release(ser)                                       # VMIN back to 1: Web Serial works on the port afterwards
        if active.get(path) is ws:
            del active[path]
        log(path, "released")


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8080)
    a = ap.parse_args()
    async with serve(handler, "127.0.0.1", a.port, process_request=process_request, max_size=None, compression=None):
        log(f"http://localhost:{a.port}  (S3 {RX_PORT}, C3 {TX_PORT})")
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
