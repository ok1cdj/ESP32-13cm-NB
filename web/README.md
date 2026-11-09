# NB 13 cm přijímač – webová stránka (fáze 1)

ESP32-S3 s firmwarem ESP-SDR (IQS stream) přes Web Serial: spektrum, vodopád, CW demodulace se zvukem; ovládání CW majáku
na C3 (ESP32-DATV-SA, větev `cw-beacon`).

```sh
python3 -m http.server 8080 --bind 127.0.0.1 -d web      # pak v Chrome / Edge: http://localhost:8080
node web/test/test.mjs                                     # testy protokolu a DSP (nahrávka build/rx/iqs_cw.cf32)
```

- **Připojit S3** / **Připojit C3**: oba porty jsou „USB JTAG/serial debug unit“ (Espressif); stránka ověří `INFO` a
  při záměně ohlásí chybu.
- **Start**: LO S3 4 MHz pod středem (mód 2), PLL zaokrouhlení dopočítané → kmitočty na Hz při společném TCXO.
- **Ladění**: klik do spektra nebo vodopádu (přichytí se k nejsilnějšímu binu ±5 px), kolečko nad vodopádem 10 Hz
  (Shift 100 Hz), nebo pole „poslech“. Zoom kolem poslouchaného kmitočtu.
- **CW**: posun na 0 Hz, decimace na 7812,5 Hz, komplexní filtr (šířka), BFO tón, AGC; zvuk přes AudioWorklet.
- **C3**: CW ON / OFF, AMP (výkon: 100 ≈ +3 dBm, 10 ≈ −17 dBm, 3 ≈ −27 dBm), F.

Moduly `iqs.js` (protokol, bez DOM) a `dsp.js` (FFT, CW demodulátor) jsou společné pro stránku i testy v Node.
