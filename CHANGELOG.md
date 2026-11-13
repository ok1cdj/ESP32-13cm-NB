# Changelog

NB TRX (the Android app in `android/`) and the web page (`web/`, https://ok1cdj.github.io/ESP32-13cm-NB/). Versions are the
app's release tags. The app takes the page from the web, so page changes reach it without a new app; they are listed under the
version that was current when they came out.

## 0.4 – 2026-11-13

### App
- **Update check:** once a day the app asks GitHub for a newer release and offers it with what is new (*Download*,
  *Skip this version*, *Later*). *Check for updates* asks right away; the daily check can be switched off.

## 0.3 – 2026-11-13

### Page
- **Transmitting from the microphone works.** The page opened the microphone only after it had switched the C3 to SSB; asking
  for the permission took longer than the C3 waits for data (0.5 s), so the C3 ended its run and the audio went nowhere
  while the *out* meter moved.
- **Microphone without dropouts and with little delay:** the page counts what is queued in the C3 by its own clock (the C3's
  reports come late) and keeps about 40 ms there. The TX row shows the queue and gaps, drops and the longest wait.
- **You hear yourself while transmitting** (headphones), and the receiver is back at full sensitivity right after the PTT:
  its AGC returns to the level from before the transmission instead of recovering for about 10 s.
- **▼ ▲ buttons** next to centre, F and AMP, in the page's colours, on a phone too (it has no spinners); held = repeats.
- Frequencies keep three decimals: 2320.050, not 2320.05.
- **PTT on a phone:** holding it no longer opens Android's copy menu, and a finger sliding a little off the button does not
  end the transmission.

## 0.2 – 2026-11-13

First release of the app.

### App
- USB bridge for the page: the ESP32-S3 receiver and the ESP32-C3 transmitter on USB OTG (a powered hub for both), the page
  in Chrome on http://localhost:8080. Boards plugged in later are added, unplugged ones dropped.
- The page comes from the web and is kept for offline use (or the copy built into the app).
- Own icon, About, signed with its own release key.

### Page
- Receiver (S3, ESP-SDR IQS): spectrum, waterfall, CW and USB audio, beacon presets of IARU Region 1 nearest first.
- Transmitter (C3): CW beacon, CW text sent once, USB from the microphone, a file or test tones, PTT button and Tab key,
  *Calibrate DC (S3)*.
- Callsign and locator (no transmitting without a callsign), firmware flasher for both boards (Chrome / Edge on a computer).
