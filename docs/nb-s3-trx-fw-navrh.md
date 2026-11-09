# Vlastní firmware RX + TX na jedné ESP32-S3 – návrh

9. 11. 2026 · jen návrh, nic neimplementováno · navazuje na průzkum [`nb-s3-trx-report.md`](nb-s3-trx-report.md)

## Proč S3 a na čem stavět

- **Základ: esp32-sdr-trx (0BSD)** – hotový spojitý RX (rtl_tcp, 250/333 ksps), polární TX (`espdr-tx`), zdokumentované
  registry I/Q playback enginu. 0BSD → lze převzít do vlastního GPL firmwaru.
- RX i TX už jsou ve stejném zdrojovém stromu, jen se buildí jako **dva image** nahrávané do RAM (dnešní přepnutí ~8 s).
- **Fork ESP32-DATV-SA (C3, PolyForm) nemíchat** – případný „držený registr“ na S3 implementovat nezávisle.
- Jednočipová C3 jen jako alternativa, pokud SP8ESA potvrdí spojitý RX na C3 (TX na C3 je hotový, RX ne).

## Architektura: jeden image, stavový automat

```
        ┌──────── USB příkaz / GPIO klíč / časovač ────────┐
IDLE ──► RX (stream I/Q) ◄──► TX_CW (polární) ──► (později) TX_IQ (playback)
```

| Část | Řešení |
|---|---|
| **RX** | beze změny z espdr: capture v bankách 0–2, decimace na core 1, stream přes USB; LO **80 kHz vedle** přijímaného kmitočtu (hrb kolem LO) |
| **TX CW (fáze 1)** | polárně: testovací tón PHY, kmitočet přes sigma-delta PLL, amplituda přes kód zisku; **klíčování a časování dělá čip sám** (text z NVS, GPIO klíč, nebo klíčovací stream z hostu) |
| **TX I/Q (fáze 3)** | playback engine (banka 2, 80 MS/s, re-trigger) nebo držený registr jako na C3, pokud na S3 projde; RX ring se pak přesune do bank 0–1 |
| **Paměť** | polární TX nepotřebuje žádnou banku → **nekoliduje s RX** – proto je první fáze jednoduchá |
| **Jádra** | core 1 = RX DSP; v TX RX stojí, časová smyčka TX může běžet na core 1 s vypnutými přerušeními (jako C3), USB obsluhuje core 0 |

## Přepínání RX ↔ TX

- **RX → TX:** dokončit rozpracovanou jednotku capture a zastavit ji → uvolnit „jen příjem“ stav PBUS → přeladit PLL
  na TX kmitočet → `CTRL_TX = 1`, čekat t1, `PA_REQ = 1` → zapnout tón s náběhem obálky.
- **TX → RX:** doběh obálky, vypnout tón → `PA_REQ = 0`, čekat t2, `CTRL_TX = 0` → obnovit RX stav (PBUS, zisk),
  přeladit LO s offsetem → znovu spustit capture → **do streamu vložit značku „TX mezera“** (host ví o díře v I/Q).
- **Cíl < 10 ms** – nikdo neměřil, je to první věc k ověření. Pro CW/OOK48 stačí desítky ms (QSK neřešíme).
- Sekvencování spínače a PA ve firmwaru + hardwarová pojistka (AND hradlo, pull-downy) podle kap. 9
  [`nb-cw-ssb-13cm.md`](nb-cw-ssb-13cm.md); piny bez strappingu.
- **Riziko:** PHY se po TX znovu kalibruje (na C3 posun úniku LO o desetiny kódu) → ověřit, že RX po návratu nemá jiné
  DC; případně krátká rekalibrace po přepnutí.

## Kmitočet a obálka – slabiny polárního TX

- **Krok PLL 457,8 Hz:** pro TX přesně na Hz dither slova SDM (espdr-tx tím dosahuje ~28,6 Hz), nebo TX na mřížku PLL
  a RX dorovnat digitálně. Pro CW obojí stačí.
- **Kód zisku má rozsah jen 18 dB:** obálka raised cosine shora jen do −18 dB, pod tím tvrdé vypnutí tónu → malé
  „cvaknutí“ na −18 dB. **Hlavní důvod pro fázi 3** (I/Q / držený registr): plné tvarování obálky, SSB bez AM-PM,
  čistý OOK48.

## Protokol a host

- Rozšířit narrowband protokol espdr: `TX_CW_START` (parametry / text), `TX_STOP`, `PTT`, `STATUS`; značky ve streamu
  (TX mezera, později PPS časové značky).
- Host nejdřív Python (navázat na `tools/cw_analyze.py`, `tools/rx_record.py`), pak webová aplikace (Web Serial) podle plánu.

## Fáze

| Fáze | Obsah | Ověření |
|---|---|---|
| **P0** | jeden image = RX espdr + polární TX, příkaz přepnutí módu | **doba přepnutí**, RX po TX stejný (DC, zisk) |
| **P1** | CW na čipu (text, GPIO klíč), GPIO sekvence T/R + PA | tinySA spektrum, klíčování; protistanice druhá deska (C3 nebo S3) |
| **P2** | experiment: držený I/Q registr na S3 (hold + 1 slovo) | tinySA: nosná z NCO jako na C3 |
| **P3** | TX I/Q (držený registr, nebo playback s re-triggerem), RX ring v bankách 0–1 | obálka, SSB dvoutón, OOK48 |
| **P4** | webová aplikace TRX | celý řetězec |

## Rizika

- Nedokumentovaný stav PHY při přepínání – největší neznámá, P0 ji odhalí brzy a levně.
- IRAM a paměť: na C3 se smyčka do IRAM nevešla; S3 má víc místa, ale RX DSP ho také potřebuje.
- USB přes vytížený hub: při 333 ksps jsme ztráceli data → počítat s 250 ksps.
- Banka 3 překrývá data ROM – nepoužívat.
- Vysílač vyzařuje svůj LO i v klidu (viděno u C3) – u jednočipové varianty nevadí, LO při RX je přijímač sám.

## Doporučení

Začít **P0**: malý krok (spojit dva existující buildy + příkaz přepnutí), hned ukáže, zda je jednočipová varianta
reálná. Dvoudesková sestava C3 + S3 zůstává funkční záloha.
