# NB TRX – Android USB bridge

The web page of this repository (`web/`) on an Android phone or tablet: Chrome on Android has no Web Serial, and WebUSB
cannot claim CDC-ACM devices there (Android binds its own driver; the same wall as the QDX in FT8web), but an app may claim
them through the USB host API. This app does, for the ESP32-S3 receiver and the ESP32-C3 transmitter (both 303a:1001,
told apart by asking `CAPS`), and serves the page with them on **http://localhost:8080** exactly as `tools/web_bridge.py`
does on the PC: `/bridge.json`, WebSocket `/serial/s3` and `/serial/c3`. The page needs no change; localhost is a secure
context, so the microphone and the audio worklets work. No network is needed.

Use: both boards on a USB OTG hub (better a powered one: two ESP32 and the TCXO board), open **NB TRX**, allow USB for each
board (plugging a board in also opens the app), the bridge starts by itself, then **Open in Chrome** → Auto connect.
The bridge runs as a foreground service (notification) while Chrome is in front.

**The page comes from the web**: on every request the app takes the file from the hosted page
(https://ok1cdj.github.io/ESP32-13cm-NB/, 2 s timeout) and keeps it for offline use; without a connection the kept copy,
else the copy built into the APK (`PageFiles.kt`). A new page needs no new app, only a change of the bridge does: the
app's bridge version is in `/bridge.json`, and the page asks for a newer app when it needs one. The switch "Latest page
from the web" off: only the kept or built-in copy. The page's firmware row (flasher) is hidden here: Chrome on Android has
no Web Serial; flash from a computer.

**Download**: the APK of each release (tag `v*`, `.github/workflows/android.yml`, signed with the NB TRX release key) is
on https://github.com/ok1cdj/ESP32-13cm-NB/releases with its SHA-256.

Build (Android SDK in ~/Android/Sdk, a JDK with javac, e.g. Android Studio's):

```sh
cd android && JAVA_HOME=/opt/android-studio/jbr ./gradlew assembleDebug     # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`UsbCdc.kt` comes from ESP32-ATV (`android/app`, GPL-3.0). The page's files are copied into the APK's assets at build time.
