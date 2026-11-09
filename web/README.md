# NB 13 cm přijímač – webová stránka (fáze 1)

ESP32-S3 s firmwarem ESP-SDR (IQS stream) přes Web Serial: spektrum, vodopád, CW demodulace se zvukem; ovládání CW majáku
na C3 (ESP32-DATV-SA, větev `cw-beacon`).

```sh
tools/web_bridge.py                                        # stránka + most k deskám přes WebSocket: http://localhost:8080
node web/test/test.mjs                                     # testy protokolu a DSP (nahrávka build/rx/iqs_cw.cf32)
```

**Most (`tools/web_bridge.py`) je výchozí cesta:** Web Serial v Chrome 140 na tomhle Linuxu hlásí „The device has been lost“
1 ms po otevření kterékoli desky (pyserial ze stejných portů čte normálně; v kernel logu žádné odpojení). Most otevře porty
z `tools/nbports.py` přes pyserial a předá bajty stránce přes WebSocket (`/serial/s3`, `/serial/c3`); stránka ho pozná
podle `/bridge.json` a funguje pak v libovolném prohlížeči. Servírovaná jiným serverem (`python3 -m http.server -d web`)
použije Web Serial s výběrem portu.

- **Připojit S3** / **Připojit C3**: přes most rovnou podle `tools/nbports.py`; přes Web Serial jsou oba porty „USB JTAG/serial
  debug unit“ (Espressif). Stránka ověří `INFO` a při záměně ohlásí chybu.
- **Start**: LO S3 4 MHz pod středem (mód 2), PLL zaokrouhlení dopočítané → kmitočty na Hz při společném TCXO.
- **Ladění**: klik do spektra nebo vodopádu (přichytí se k nejsilnějšímu binu ±5 px), kolečko nad vodopádem 10 Hz
  (Shift 100 Hz), nebo pole „poslech“. Zoom kolem poslouchaného kmitočtu.
- **CW**: posun na 0 Hz, decimace na 7812,5 Hz, komplexní filtr (šířka), BFO tón, AGC; zvuk přes AudioWorklet.
- **C3**: CW ON / OFF, AMP (výkon: 100 ≈ +3 dBm, 10 ≈ −17 dBm, 3 ≈ −27 dBm), F.

Moduly `iqs.js` (protokol, bez DOM) a `dsp.js` (FFT, CW demodulátor) jsou společné pro stránku i testy v Node.
