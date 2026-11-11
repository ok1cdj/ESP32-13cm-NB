# Jedna neupravená XIAO ESP32-S3 jako NB transceiver + GPS/PPS – průzkum

11. 11. 2026 · krok 0 (zdroje) hotový, kroky 1–2 (experimenty, závěry) se doplňují · navazuje na
[`../nb-s3-trx-report.md`](../nb-s3-trx-report.md) a [`../nb-s3-trx-fw-navrh.md`](../nb-s3-trx-fw-navrh.md)

Zdroje a přečtené revize:

| Zkratka | Repozitář | Revize | Licence |
|---|---|---|---|
| IZ7PDX | https://github.com/Photoluis/Esp32s3-cam-pdx-datv-beacon | `e182f35` | GPL-3.0 |
| eSpDR | https://github.com/h0m3us3r/eSpDR | `f279bf8` | 0BSD |
| sdr-trx | https://github.com/jochenhammes/esp32-sdr-trx | `e1aebbf`, větev `research/iq-tx` `6de35a5` | 0BSD |
| ESP-SDR | https://github.com/zodoczi/esp-sdr (fork ESPARGOS/esp-sdr), lokálně `fw/esp-sdr` | `4128c24` (release `s3-fw-2026.10.08b`), první commit `e605684` | GPL-3.0-or-later |

Odkazy na řádky v textu jsou `soubor:řádek` v dané revizi. Pro IZ7PDX:
`https://github.com/Photoluis/Esp32s3-cam-pdx-datv-beacon/blob/e182f356ea863e24d6e43644e6a01834246052f0/<soubor>#L<n>`.

## Shrnutí

- **Vysílat z S3 jde, a to dvěma ověřenými cestami.**
  - **Držený registr** DAC (IZ7PDX, DVB-S2 s MER 20–26 dB): CPU zapisuje jedno slovo I/Q ve smyčce 1–4 MS/s.
  - **Smyčkové přehrávání bufferu** (první commit ESP-SDR): hardware přehrává buffer v bance 2 rychlostí 40/80 MS/s,
    CPU je volné.
- **Přepínání TX↔RX na jednom čipu nikdo nevyřešil.**
  - IZ7PDX („Parrot“) přepíná **rebootem**.
  - sdr-trx nahrává do RAM druhý image, což trvá ~8 s.
  - Doba přepnutí v jednom firmwaru je proto první věc k měření.
- **Únik LO ani obraz I/Q nikdo na S3 jako vysílači nezměřil.** Vnitřní kalibrační smyčka TX→RX existuje v ROM S3,
  ale na S3 ji zatím nikdo nespustil.
- **Nejlepší základ je ESP-SDR (GPL).** Má spojitý příjem bez mezer (IQS), který už dnes používá naše webová aplikace.
  Přeladění během streamu trvá ~9 ms. TX z jeho prvního commitu lze vrátit.

## A) Vysílání na S3 (IZ7PDX)

Kód je `firmware/main/rf_s3.c` a `rf_s3.h`. Board diymore ESP32-S3-CAM N16R8, ESP-IDF 6.1, potřebuje 16 MB flash
(`partitions.csv:5-7`) a `CONFIG_ESP_PHY_ENABLE_CERT_TEST=y` (`sdkconfig.defaults:4`).

- **Registry** (rf_s3.c:4-10, 29-33). Adresy jsou podle hlavičky převzaté z `librftest.a` (`dactrig`/`adctrig`)
  a porovnané s C3:
  - `DAC_CTRL 0x60033D64`
  - data `0x3FCD0000` (I bity 0–9, Q bity 10–19, 10bit doplňkový kód; rf_s3.h:11-12)
  - předání banky `0x600C101C` (`MAC_DUMP_USAGE[3:0]=4`)
  - rezervace SRAM `0x3FCC0000–0x3FCE0000`
- **Klíčování** `tx_begin` (rf_s3.c:131-143):
  1. `g_phyFuns[47](1)` (vynucený TX)
  2. 3 ms čekání
  3. předání banky
  4. `DAC_CTRL = 0x80000|1`, pak s bitem 31 (run)

  Konec je `tx_end` (rf_s3.c:145-154): `phy_txforce(0)`, `txcal_work_mode()`, RX klid.
- **Držený registr.** CPU přepisuje `DAC_BUF[0]` podle cyklového čítače, smyčka je v IRAM s vypnutými přerušeními
  na core 0 (rf_s3.c:182-217, 304-311).
  - Rychlost 1/2/4 MS/s, výchozí 2 MS/s (main.c:587-589).
  - Při 4 MS/s zbývá 60 cyklů na vzorek a ~1/3 vzorků přijde pozdě (docs/TEST_SR_20261101.md:14-15).
- **Obrazy.** ZOH dává obrazy na LO + f ± k·fs. Repo je neměří, jen vyžaduje pásmovou propust (README.md:59).
- **Ladění.**
  - Uživatelský rozsah 2300–2450 MHz (rf_s3.h:7-8).
  - `set_chanfreq` + `phy_set_freq(MHz, kHz)` (rf_s3.c:114-127).
  - Krok PLL 30 MHz/65536 = 457,8 Hz (`pll_hz`, rf_s3.c:90-103).
  - NCO je 32bitový fázový akumulátor nad tabulkou 1024 cos, rozlišení fs/2³² (rf_s3.c:176-217).
- **Výkon.** Jen digitální amplituda 1–480 kódů (480 = „0 dB“), komprese nad ~430 (rf_s3.h:9; beacon_cfg.c:26-33).
  Výkon v dBm není kalibrovaný.
- **Kalibrace PHY.**
  - Jen ta z `esp_wifi_start` při bootu (rf_s3.c:55-88).
  - Po použití AP je rádio „špinavé“ a další TX jde až po rebootu (web_ui.c:28,265; main.c:83-92).
  - Únik LO se ručně koriguje `dci/dcq` ±100 kódů, a to jen u QPSK (rf_s3.c:284; beacon_cfg.c:216-218).
  - **Čísla úniku LO a obrazu I/Q v repu nejsou.**
- **Kvalita.**
  - MER 20,3–26,0 dB, nejlépe 26,0 dB při −9,6 dB (docs/TEST_MER_20261030.md:19-30).
  - Komprese nad −3,5 dB (tamtéž, ř. 52-56).
  - Chyba kmitočtu ≈ −2 kHz na 2375 MHz, tj. 1 ppm (tamtéž, ř. 61-63).
- **Co převzít pro NB.**
  - CW na offsetu NCO: `pdx_rf_tx_tone` (rf_s3.c:212-238). Klíčovat amplitudou, ne `tx_begin`, protože ten má 3 ms.
  - SSB z hostu: vzor `pdx_rf_tx_qpsk_ring` (rf_s3.c:343-410). Ring plní core 1, core 0 ho čte podle termínů;
    50 kS/s se interpoluje na 1–2 MS/s.

## B) Příjem a přepínání (Parrot, IZ7PDX)

- **TX→RX i RX→TX se dělá rebootem.**
  - `reboot_and_run("PARROTPAUSE …")` / `("PARROTREPLY …")` → `esp_restart` (main.c:137-152, 508-531).
  - Hlavička to říká přímo (rx_s3.h:11-12).
  - Stav přežije v RTC RAM, po bootu znovu proběhne `pdx_rf_init` s kalibrací PHY (main.c:1135).
- **Doba přepnutí v ms není uvedená.**
  - Naladění RX ~25 ms (docs/PARROT_P1.md:9).
  - Prvních 1,5 s RX má falešné hrby a zahazuje se (main.c:435,450-451).
  - Odpověď přijde za 30–45 s, ale to dominuje dekódování DVB-S2.
  - Přepnutí bez rebootu je otevřený bod (docs/PARROT_P0.md:68).
- **RX** (`rx_s3.c`):
  - Vlastní PLL přes regi2c `0x62/0x63` + sken 512 kódů VCO (rx_s3.c:76-118).
  - `configure_rx` vypne AGC, vynutí zisk a nastaví `DUMP_CONFIG=0x000C2040` (rx_s3.c:150-180).
  - Dump 16 MS/s, ping-pong bank A/B (`0x3FCC/0x3FCD0000`) po 12288 párech, sentinely z sdr-trx, CIC na 1–2 MS/s,
    int8 (rx_s3.c:202-221, 495-613).
  - Data jdou do 2s bufferu v PSRAM (main.c:94,762-764) a ven přes UART 230 kbd (main.c:825-850).
  - Interní spury na 2368,000 a 2375,8–2376,2 MHz (PARROT_P1.md:13-14).
- **Spojitý NB příjem** by s tímto enginem principiálně šel, ale firmware dělá jen dávky. ESP-SDR (D) to už umí.

## C) eSpDR a esp32-sdr-trx

| | eSpDR | esp32-sdr-trx |
|---|---|---|
| Licence | 0BSD | 0BSD; NOTICE: postaveno na eSpDR, linkuje `libphy.a` |
| Umí | **jen RX**, 80 MS/s přes 16 GPIO do FPGA a USB3 (README:9-10, 28) | **RX** `espdr-rx` (rtl_tcp 250/333 ksps) a **TX** `espdr-tx` (polární FM/USB/LSB/RTTY) |
| Stav | 3 commity, testbench RTL, docs RADIO.md / LO-EXTENSION.md / CLOCK-SYNC.md | 39 commitů, rc1–rc4, 55 testů, RX „stable, 1 deska“, TX „experimental“ |

V ESP32-ATV je submodul `third_party/ESP32-DATV-RX` (https://github.com/ok1cdj/ESP32-DATV-RX, BSD-3) a ten obsahuje
sdr-trx ve složce `esp32-sdr-trx/` (0BSD, + `cs4.patch` pro 500 ksps).

- **Dump engine.**
  - Řízení `0x60033D5C` (bit 31 run, bit 16 = 16 MS/s, `0x24000` kruh 16384 párů), zápisový index `0x60033D60`,
    výběr bytů `0x60033D90` (sdr-trx board.h:32-38; eSpDR RADIO.md:41-84).
  - Banky `0x3FCB/CC/CD/CE0000`, z nichž banka 3 překrývá data ROM. Přístup jen po 32 bitech.
  - Konvence LO − RF.
- **PLL.** `960 MHz + 30 MHz·W/65536`, krok 457,76 Hz; v režimu 5/6 krok 381,47 Hz. Pokrytí ~1,84–2,79 GHz
  (RADIO.md:162-223).
- **Polární TX** (TX-RESEARCH.md, internals.md:177-230):
  - Testovací tón PHY `start_tx_tone_step`.
  - Kmitočet přes nízký byte SDM (457,8 Hz, ±44 kroků).
  - Amplituda kódem v `0x60006040[17:10]`: 0,28 dB/krok, rozsah 17,9 dB.
  - SSB: nežádoucí postranní pásmo 61–63 dB, IM3 33 dB.
  - **RX a TX jsou dva RAM image**, přepnutí přes `esptool load-ram` ~8 s (TX-RESEARCH.md:330-352).
- **I/Q playback `0x60033D64`** (TX-RESEARCH.md:374-473; research/iq-tx `docs/research/IQ-TX-PHASE-A.md`):
  - Bity: 13:0 počet−1, 15 rychlost 40/80 MS/s, 18 hotovo, 19 „hold“, 31 run. Buffer v bance 2.
  - Bit 18 `0x60006040` (generátor tónu) musí být po klíčování vynulovaný.
  - Zrcadlo je 33 dB, s předkorekcí `Q' = 1,010 Q − 0,055 I` 62 dB.
  - TX filtr `0x67` reg 12/13; lineárně do ~200/511.
- **Rozpor v bitu 19.** sdr-trx ho nazývá „hold“, ale první commit ESP-SDR ho používá jako **smyčku**:
  - `e605684:main/continuous_replay.h:87-88`: `ctrl=0x80080000|n` = „unlimited replay“.
  - `e605684:main/s3_main.c:204`: opakování `(1<<19)|(repeats<<20)`.
  - Na C5 je dvojče tohoto registru zdokumentované s bitem 19 jako loop.
  - **Ověřuje se v kroku 1.**

### Vnitřní smyčka TX→RX (kalibrační loopback)

- **ROM S3 exportuje funkce pro loopback** (esp-idf `components/esp_rom/esp32s3/ld/esp32s3.rom.ld:1236-1299`):
  `rom_loopback_mode_en` (0x40005da8), `rom_set_loopback_gain` (0x40005ef8), `rom_dc_iq_est`,
  `rom_iq_est_enable/disable`, `rom_set_cal_rxdc`, `rom_en_pwdet`, `rom_set_tx_dig_gain`, `rom_iq_corr_enable`.
- **`libphy.a` S3 obsahuje kalibrační funkce:** `txdc_cal_v70`, `txiq_cal_init`, `rfcal_txiq`, `txiq_get_mis_pwr`,
  `rfcal_rxiq`, `pwdet_tone_start`, a také značku `LB_TXIQ`.
- **Na C61/S31 ji ESP-SDR provozoval** (`e605684:main/modem.c:37-55, 610-701`): `phy_loopback_mode_en(1)`,
  `phy_set_loopback_gain`, zdroj tón nebo přehrávání.
- **Na S3 to nikdo nezkoušel.** Jediné interní měření TX je zatím detektor výkonu `txtone_linear_pwr()`, který vrací
  jedno číslo bez kmitočtu.
- **Omezení:**
  - Přehrávání i záznam používají jeden registr bank.
  - Únik LO TX padá v loopbacku na DC přijímače, takže jde měřit jen rozdílově (klíčováno/neklíčováno, krokování
    korekce).
  - Obraz zahrnuje i nesymetrii RX, takže nejdřív kalibrovat RX.
  - Loopback neřekne nic o anténní cestě.

## D) ESP-SDR (ESPARGOS, GPL) – dnešní přijímač

- Používá stejný dump engine (`main/targets/esp32s3/receiver.c:154-201`, `main/common/ring_capture.c:103-109`),
  ale nad plným ESP-IDF s Wi-Fi v promiskuitním režimu (receiver.c:468-486).
- **Ladění** přes knihovnu PHY `set_chanfreq` + `set_rf_freq_offset` (receiver.c:52-64). Při změně MHz se volá
  `rx_recalibrate` (rx_recalibration.c:120-195).
- **Ring ve 3 bankách** `0x3FCB–0x3FCE0000` bez ROM banky, přepínání po 12288 párech (ring_capture.h:19-29).
- **IQS:** decimace 64–1024 (250–15,6 kS/s), 4/8/16 bitů, dvoustupňový FIR na core 1.
  - Rámec nese 64bitový index vzorku, příznaky mezery/ztráty a CRC32 (docs/iq-stream.md:11-73).
  - Mode 2 = posun +fs/4 (LO 4 MHz pod středem, DC mimo pásmo).
- **Přeladění `T`** během streamu: jen PLL, ~9 ms včetně restartu běhu (receiver.c:215-227, 336-351).
- **TX dnes chybí** (test `tests/test_receive_commands.py:53-56` čeká `ERR`). První commit `e605684` měl na S3
  přehrávání, smyčku a CW; odstraněno v `ab76232`.
- **Proti IZ7PDX:** spojitý stream s počítadlem vzorků, USB, rychlé přeladění a už funguje s `web/`.
  → **Základ pro jednodeskový TRX.**

## E) Licence – co lze převzít do GPL projektu

| Zdroj | Licence | Do GPL | Poznámka |
|---|---|---|---|
| ESP-SDR | GPL-3.0-or-later | ano | základ forku `fw/esp-sdr` větev `s3-trx` |
| IZ7PDX | GPL-3.0 (`rx_lo_plan.h` 0BSD) | ano, s uvedením autora | TX popisuje jako „port metody SP8ESA, napsáno od nuly“, adresy z `librftest.a` |
| eSpDR, esp32-sdr-trx | 0BSD | ano | znalosti registrů, sekvence |
| ok1cdj/ESP32-DATV-RX | BSD-3-Clause | ano | obal sdr-trx |
| esp-dsp, části ESP-IDF | Apache-2.0 | ano (GPL-3 je kompatibilní) | |
| ESP32-DATV-SA (C3 fork) | PolyForm Noncommercial | **ne** | pro S3 nečíst, nekopírovat |
| `libphy.a`, `librftest.a`, ROM | binárky Espressif | linkuje se, stejně jako dnes | |

TX pro S3 vzniká z GPL/0BSD zdrojů (ESP-SDR `e605684`, IZ7PDX, dokumentace sdr-trx), s odkazem na autory v hlavičce.

## F) GPS / PPS (návrh, navazující úkol)

### Piny XIAO ESP32-S3 Plus
Zdroj: Seeed wiki *XIAO ESP32-S3 Plus Pin Map*, datasheet ESP32-S3 v2.2, tabulka 2-2.

| Funkce | Pin | Poznámka |
|---|---|---|
| PPS → MCPWM capture | **D0 / GPIO1** | sériový odpor 100–330 Ω; záloha D3 / GPIO4 |
| GPS TX → UART1 RX | **D7 / GPIO44** | |
| UART1 TX → GPS RX | **D6 / GPIO43** | konzole na USB-JTAG; text ROM po resetu GPS ignoruje |
| CTRL_TX (T/R spínač) | **D8 / GPIO7** | pull-down |
| PA_REQ (do hradla AND) | **D9 / GPIO8** | pull-down |
| LNA_EN | **D10 / GPIO9** | pull-down |

Nepoužívat:
- GPIO0 a GPIO3 (strapping; GPIO3 je D2)
- GPIO19/20 (USB)
- GPIO26–37 (flash/PSRAM, nevyvedené)
- GPIO10 („ADC_BAT“ bez děliče)

GPIO1–14 mají po zapnutí ~60 µs log. 0, což je s pull-down bezpečné.

### Měření kmitočtu krystalu
- **MCPWM capture na S3 má jediný zdroj hodin, APB 80 MHz** (`clk_tree_defs.h:299-307`). Tik je 12,5 ns.
- APB jde z BBPLL a ta z krystalu, takže **rozdíl dvou záchytů měří přímo chybu krystalu**.
- Hrana se latchuje v hardwaru, latence ISR nevadí. 32bitový čítač přeteče po 53,7 s.
- API: `mcpwm_new_capture_timer` → `mcpwm_new_capture_channel(gpio, pos_edge, prescale=1)` → `on_cap` callback.
- ETM na S3 není. GPTimer by měl jitter ISR.
- **Výpočet:**
  - δ = (N − 80·10⁶·T)/(80·10⁶·T) přes okno T = 10–30 s.
  - Odlehlé hodnoty (chybějící nebo dvojitý pulz, |ΔN − 80e6| > 2000) zahodit.
  - Medián z 5 a pak EMA nebo jednoduchý Kalman (stav: δ, dδ/dt).
  - Holdover: poslední δ + trend, příznak „bez PPS“.
- **Přesnost.** PPS jitter je ~30 ns RMS (M8N), takže na 10 s je to ≈ 4 ppb ≈ 10 Hz na 2320 MHz.
  - Korekce qErr (UBX-TIM-TP) jen s NEO-M8T/LEA-M8T. M8N qErr nedává (N8UR, TAPR 2020).
  - Pro korekci kmitočtu stačí NEO-M8N.
- **Použití:**
  - Jeden krystal, takže jedna korekce platí pro NCO TX i RX (posun `FOFS`/NCO).
  - Index vzorku IQS na hraně PPS přenášet jako značku ve streamu: časování OOK48 na UTC a značky pro hosta.
- **Jádra.**
  - Core 1: smyčka RX ringu, resp. TX.
  - Core 0: USB, příkazy, callback PPS (běží jednou za sekundu; hodnota je latchovaná, takže se nepočítá s latencí).
- **Hardware:**
  - NEO-M8N (nebo NEO-6M), TIMEPULSE 3,3 V CMOS, sériový odpor 100–330 Ω u zdroje.
  - **Žádné RC**: pomalá hrana zvyšuje jitter.
  - Napájení ~25–40 mA z 3V3 XIAO.
  - Nastavení: UBX-CFG-TP5 (1 Hz, `lockGnssFreq`, `alignToTow`, bez pulzu bez fixu), uložit přes CFG-CFG.

## Jedna deska, nebo dvě (napojení PA a LNA)

Podle [`../nb-cw-ssb-13cm.md`](../nb-cw-ssb-13cm.md) kap. 9 (ř. 357-387):

| | Jedna S3 (TRX) | Dvě desky (TX + RX) |
|---|---|---|
| RF spínače | **2**: malý SPDT u čipu (PA / LNA) + HMC8038 u antény | **1**: HMC8038 u antény |
| Řízení | CTRL_TX, PA_REQ, LNA_EN z jednoho čipu, sekvence ve FW | dva čipy, sekvence přes oba (nebo hardware) |
| Kmitočet | jeden krystal → TX a RX koherentní, jedna korekce PPS | dva krystaly → bez TCXO/PPS na obou nekoherentní |
| Přepnutí | doba přepnutí ve FW (měří krok 1) | okamžité, RX běží dál i při TX (příposlech) |

Rozhodnutí podle výsledků kroku 1.

## Krok 1 – experimenty

Sestava: XIAO ESP32-S3 Plus bez úprav (MAC 28:84:85:8A:C1:78), U.FL → 30 dB → tinySA Ultra+.
Firmware: fork ESP-SDR `fw/esp-sdr`, větev `s3-trx`, soubor `main/targets/esp32s3/s3_tx.h` (GPL), build s ESP-IDF 6.1.
Klient: `tools/s3trx.py`. Úrovně jsou na konektoru S3 (útlum 30 dB přičten), přesnost tinySA ±1–2 dB.

### Vysílání na S3

- **Jak se klíčuje.** `g_phyFuns[47](1)` (vynucený TX), pak `stop_tx_tone(1)` (generátor tónu vypnutý) a předání
  banky 2. Takto to dělá IZ7PDX.
  - Varianta z prvního commitu ESP-SDR přes `esp_phy_wifi_tx_tone()` **nevysílala**: ta funkce jen zařadí požadavek
    pro testovací úlohu PHY. Navíc její parametr 80 znamená útlum 20 dB.
- **Bit 19 `0x60033D64` = hardwarová smyčka.**
  - `TXLOOP` přehrává buffer 16 000 slov při 40 MS/s donekonečna a CPU je volné, takže příkazová smyčka i USB běží dál.
  - Rozpor „hold vs loop“ (C) je tím vyřešen: **loop**.
  - Offset tónu je ale omezený na k·fs/n (pro 40 MS/s po ~2,4 kHz). Přesně 100 kHz jde.
- **Držený registr (`TXHOLD`, CPU NCO 2 MS/s, přerušení vypnutá) funguje také.** 8 000 000 vzorků, 0 pozdních,
  max. zpoždění 15 cyklů. Offset jde nastavit na libovolné Hz, takže je to cesta pro SSB z hostu.
- **Výkon** (offset +100 kHz, 2320,2 MHz):

  | amp | nosná | únik LO | obraz I/Q |
  |---|---|---|---|
  | 50 | +3,7 dBm | −29 až −31 dBc | −32 dBc |
  | 150 | +12,7 dBm (začíná komprese) | −43 dBc | −21 až −23 dBc |

  Grafy: `lo_loop_amp50.png`, `lo_hold_amp50.png`, `lo_loop_amp150.png`. Oba režimy dávají stejné spektrum.
- **Kmitočet.** Krystal XIAO spolu s tinySA ukazuje −5 až −7,7 ppm (−12 až −18 kHz na 2320 MHz). Po několika minutách
  střídavého vysílání se ustálí na −7,55 ppm (±0,02 ppm).

### Únik LO a jeho stabilita po resetu (10×, amp 50)

`reset10_amp50.csv`: po každém resetu se změřil únik a obraz a hledala se nula korekcí `TXDC` (DC v kódech DAC).

| | průměr | rozsah |
|---|---|---|
| únik LO bez korekce | −28,5 dBc | −25,0 až −32,5 dBc (absolutně −22 až −29 dBm) |
| obraz I/Q | −31,7 dBc | −30,5 až −33,0 dBc |
| nula I / Q (kódy) | −1,1 / −1,5 | I 0…−3, Q −1…−3 |
| po vynulování | | −32,5 až −48,5 dBc |

`reset10_amp50_dc-1-1.csv`: pevná korekce `TXDC −1 −1` při 10 resetech dala únik **−38,5 dBc průměrně**
(−30,5 až −48,5 dBc).

**Závěr.**
- Kalibrace PHY při startu (z NVS, `CONFIG_ESP_PHY_CALIBRATION_MODE=0`) drží únik do ~1–3 kódů DAC. Nula se mezi
  resety pohybuje o ±1 kód, tedy podobně jako u C3, jen z lepšího výchozího stavu.
- Jemnost korekce omezuje **kvantizace DAC**: 1 kód při amp 50 ≈ −34 dBc. Pevná korekce v NVS zlepší průměr o 10 dB,
  ale nejhorší případ zůstane ~−30 dBc.
- Na −45 dBc a níž je potřeba (a) korekci jemnější než 1 kód (dither DC v bufferu, větší amp při menším analogovém
  zisku) a (b) měření při každém startu, a to vnitřní smyčkou TX→RX nebo přijímačem S3 po TX.

### Přepínání TX ↔ RX na jednom čipu

`switch5.csv` a měření latence. Vše bez rebootu a v jednom firmwaru.

| Krok | Čas |
|---|---|
| RX → TX (`TXLOOP`, firmware: tune + vynucený TX + start enginu) | **4,0 ms** (stejné MHz), 22,8 ms při změně MHz (`rx_recalibrate`) |
| výpočet bufferu tónu (`TXLOOP`) | 30–60 ms; u `TXHOLD` ~1 ms. Lze počítat předem. |
| TX → RX (`TXOFF`, firmware) | **4,0 ms** (z toho 3 ms čekání v `prepare_rx`) |
| TXOFF → první rámec IQS (62,5 kS/s) | **21 ms** stejné LO, **45 ms** s RX LO o 4 MHz níž (přeladění + rekalibrace RX) |

- Příjem po TX (5 cyklů): výkon šumu ±0,4 dB, DC ±0,1 dB, spur stejný, 0 mezer ve streamu.
  **RX se po TX nemění.**
- Kmitočet TX mezi cykly kolísá o stovky Hz, což je zahřívání (viz drift).
- Zrychlení: držet RX kalibraci pro TX i RX MHz (dnes je cache jen pro jednu hodnotu), zkrátit 3ms čekání. Odhad
  TX→RX < 10 ms.

### Drift krystalu, fázový šum

*(měří se)*

## Krok 2 – závěry a doporučení

*(doplňuje se)*
