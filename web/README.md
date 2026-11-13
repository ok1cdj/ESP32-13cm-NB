# NB 13 cm transceiver – web page

Receive on the ESP32-S3 with the ESP-SDR firmware (IQS stream): spectrum, frequency axis, waterfall, CW / USB audio. Transmit
on the ESP32-C3: USB from the microphone, a file or test tones, and its CW beacon (ESP32-DATV-SA, branch `cw-beacon`). Works offline: everything is served from this computer.

```sh
tools/nb_rx.sh                       # bridge + browser on http://localhost:8080 (Ctrl-C ends the bridge)
tools/web_bridge.py                  # the bridge alone
tools/web_serve.py                   # the page alone, for Web Serial (no caching: a changed page loads at once)
node web/test/test.mjs               # tests of the protocol and DSP (recording build/rx/iqs_cw.cf32)
```

Hosted: **https://ok1cdj.github.io/ESP32-13cm-NB/** (GitHub Pages, `.github/workflows/pages.yml` publishes this folder on
every push to `main`). There is no bridge, the page uses Web Serial (Chrome / Edge on a computer).

| URL | Boards through |
|---|---|
| http://localhost:8080 | the bridge (WebSocket, any browser, no port chooser; ports from `tools/nbports.py`) |
| http://localhost:8080/?webserial | Web Serial (Chrome / Edge; the browser asks for the port) |
| http://localhost:8080/?demo | no board: a synthetic keyed tone, to check the page and the audio |

- **Auto connect**: Web Serial gives the page no device path or serial number and both boards are 303A:1001, but Chrome keeps
  the ports this page was once allowed. Each is asked `CAPS`: the S3 answers `CAPS …`, the C3 `ERR ? (commands: …)` (its
  beacon pauses for 5 s, it is not switched off). The chooser comes only for a board still missing; once both ports are
  allowed, one click connects both (bench: 0.9 s). Through the bridge the ports are known by MAC.
- **Connect S3 / Connect C3**: one board through the chooser; the page checks it (S3 `INFO`, C3 `CW` – `INFO` would switch a
  running beacon off) and refuses a swapped port.
- **Presets**: the C3 test beacon and the Czech 13 cm beacons from the ČRK list (OK0EA 2320.804 JO70UP, …; check the list),
  and the whole beacon segment 2320.79–2320.99 MHz at 250 kS/s. A preset restarts a running stream on its centre.
- **Station (row ST)**: callsign and locator, kept in this browser (localStorage). Without a callsign the page does not
  transmit: CW ON, Calibrate DC (BDC TEST sends the LO leakage), TX and PTT ask for it first. The beacon text is made
  from them (`VVV DE <call> <locator>`, editable, at most 64 characters of A-Z 0-9 / ? . , = - +) and sent with Apply.
- **Start / Stop** (one button, Stop while the stream runs): the S3's LO 4 MHz below the centre (mode 2), the PLL's rounding computed → exact frequencies on the shared TCXO.
  A new centre, rate or gain on a running stream restarts it (bench: 23–39 ms). The firmware's in-stream retune
  (`T <MHz> <kHz>`) is not used: a kHz-only retune left the LO where it was although `IQSEND` counted it.
- **Tuning**: click the spectrum or the waterfall (snaps to the strongest bin within ±5 px), wheel over the waterfall 10 Hz
  (Shift 100 Hz), or the listen field. Zoom around the listen frequency; the axis between spectrum and waterfall in MHz.
- **RX mode CW / USB**: shift to 0 Hz, decimation to 7812.5 Hz, a complex band pass (the other sideband rejected, >100 dB in
  the test), AGC; audio through an AudioWorklet. CW: ±width/2 around the listen frequency, heard at the pitch; the click
  snaps to the strongest bin. USB: the listen frequency is the suppressed carrier, the filter passes 300–2400 / 300–2700 /
  200–3000 Hz above it (shaded in the spectrum); no snapping.
- **Calibrate DC (S3)**: the C3 sends its LO leakage alone (`BDC TEST`), the S3 measures it through crosstalk (single-bin
  DFT, manual gain 50) and a coordinate search sets the DC correction (`BDC i q`, about 25 s). Valid until the C3 resets (the
  PHY calibrates anew at every start). Bench 2026-11-10: the page found −1.5 / −1.5, the tinySA at the C3's connector gave
  −39 dBm there against −23 dBm at 0 / 0. **Shown with the S3's ceramic antenna next to the C3 only**: check again after the
  S3 gets a connector or the boards move.
- **C3**: CW ON / OFF, AMP with its power at the connector next to it (from the measurement of 2026-11-10, `tools/c3_power.py`:
  linear to AMP 100 ≈ +2.5 dBm, compressed above AMP 150, at most ≈ +12.5 dBm; the board also radiates directly: the S3 next
  to it hears it strongly even at AMP 1), F.

- **TX (USB through the C3, `SSB ON`)**: source microphone, audio file (WAV …), one tone or two tones; **TX on** toggles,
  **PTT (hold)** transmits while held, and so does the **Tab** key (held; it no longer moves the focus on this page). The page makes the analytic USB signal at the C3's rate (50 kS/s): microphone and file
  through `TxChain` (AudioContext at 50 kHz, decimation to 10 kHz, complex band pass 300–2700 Hz, AGC up to +20 dB with the
  peak at 0.9, interpolation back), tones directly; int16 I, Q to the C3, paced by its fill reports (ring kept near 4000
  pairs = 80 ms; the microphone drops a chunk when the ring runs full and adds silence when it runs low). Stopping the stream
  is the PTT: the C3 goes off 0.5 s after the last data. F and AMP are the C3 row's (AMP ≤ 50–100 for linear SSB).
  Bench 2026-11-10: tone 1 kHz at F + 995 Hz on the S3 in USB mode, no underrun while transmitting; two tones equal.
  Use headphones with the microphone (the receiver's audio would feed back).

- **Firmware (row FW)**: **Flash C3 (TX)** / **Flash S3 (RX)** write the images in `fw/c3`, `fw/s3` through ESP Web Tools
  (`vendor/esp-web-tools`, 10.5.2, Apache-2.0, served from here: works offline). The dialog offers to erase the flash
  first (the C3 then forgets its NVS settings). Disconnect the board on the page before flashing. `tools/fw_bundle.sh`
  refreshes the images from the C3 build and the ESP-SDR release zip. On Linux the user needs access to the port
  (group `uucp` or `dialout`).

`iqs.js` (protocol, no DOM) and `dsp.js` (FFT, demodulator, TX chain) are shared by the page and the Node tests.

## Web Serial and "The device has been lost"

Chrome on Linux, at once after opening a port: pyserial, esptool and `idf.py monitor` leave `VMIN = 0, VTIME = 0` on the
port (`stty -F /dev/ttyACM1 -a` → `min = 0`). Chrome does not set VMIN, its first `read()` returns 0 bytes and it takes that
for a lost device. Fix: `stty -F /dev/ttyACMn min 1 time 0` (while no program holds the port); our tools
(`nbports.tty_release`) leave `min 1` themselves. Shown on the bench 2026-11-09: a port with `min 1` works, with `min 0` not.
While Chrome has opened a port it sets exclusive mode (TIOCEXCL): until the last program closes it, others get "busy".
