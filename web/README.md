# NB 13 cm receiver – web page

ESP32-S3 with the ESP-SDR firmware (IQS stream): spectrum, frequency axis, waterfall, CW demodulation with audio; control of
the CW beacon on the C3 (ESP32-DATV-SA, branch `cw-beacon`). Works offline: everything is served from this computer.

```sh
tools/nb_rx.sh                       # bridge + browser on http://localhost:8080 (Ctrl-C ends the bridge)
tools/web_bridge.py                  # the bridge alone
node web/test/test.mjs               # tests of the protocol and DSP (recording build/rx/iqs_cw.cf32)
```

| URL | Boards through |
|---|---|
| http://localhost:8080 | the bridge (WebSocket, any browser, no port chooser; ports from `tools/nbports.py`) |
| http://localhost:8080/?webserial | Web Serial (Chrome / Edge; the browser asks for the port) |
| http://localhost:8080/?demo | no board: a synthetic keyed tone, to check the page and the audio |

- **Connect S3 / Connect C3**: the page checks `INFO` and refuses a swapped port.
- **Presets**: the C3 test beacon and the Czech 13 cm beacons from the ČRK list (OK0EA 2320.804 JO70UP, …; check the list),
  and the whole beacon segment 2320.79–2320.99 MHz at 250 kS/s. A preset restarts a running stream on its centre.
- **Start**: the S3's LO 4 MHz below the centre (mode 2), the PLL's rounding computed → exact frequencies on the shared TCXO.
- **Tuning**: click the spectrum or the waterfall (snaps to the strongest bin within ±5 px), wheel over the waterfall 10 Hz
  (Shift 100 Hz), or the listen field. Zoom around the listen frequency; the axis between spectrum and waterfall in MHz.
- **CW**: shift to 0 Hz, decimation to 7812.5 Hz, complex filter (width), BFO pitch, AGC; audio through an AudioWorklet.
- **Calibrate DC (S3)**: the C3 sends its LO leakage alone (`BDC TEST`), the S3 measures it through crosstalk (single-bin
  DFT, manual gain 50) and a coordinate search sets the DC correction (`BDC i q`, about 25 s). Valid until the C3 resets (the
  PHY calibrates anew at every start). Bench 2026-11-10: the page found −1.5 / −1.5, the tinySA at the C3's connector gave
  −39 dBm there against −23 dBm at 0 / 0. **Shown with the S3's ceramic antenna next to the C3 only**: check again after the
  S3 gets a connector or the boards move.
- **C3**: CW ON / OFF, AMP (power at the connector: 100 ≈ +3 dBm, 10 ≈ −17 dBm, 3 ≈ −27 dBm; the board also radiates
  directly: the S3 next to it hears it strongly even at AMP 1), F.

`iqs.js` (protocol, no DOM) and `dsp.js` (FFT, CW demodulator) are shared by the page and the Node tests.

## Web Serial and "The device has been lost"

Chrome on Linux, at once after opening a port: pyserial, esptool and `idf.py monitor` leave `VMIN = 0, VTIME = 0` on the
port (`stty -F /dev/ttyACM1 -a` → `min = 0`). Chrome does not set VMIN, its first `read()` returns 0 bytes and it takes that
for a lost device. Fix: `stty -F /dev/ttyACMn min 1 time 0` (while no program holds the port); our tools
(`nbports.tty_release`) leave `min 1` themselves. Shown on the bench 2026-11-09: a port with `min 1` works, with `min 0` not.
While Chrome has opened a port it sets exclusive mode (TIOCEXCL): until the last program closes it, others get "busy".
