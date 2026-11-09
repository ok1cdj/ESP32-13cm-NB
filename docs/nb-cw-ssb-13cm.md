# Úzkopásmový CW / SSB / OOK48 RX a TX na 13 cm s ESP32 – poznámky a plán

Rozšíření projektu [ESP32-ATV](https://github.com/ok1cdj/ESP32-ATV) · 19. 10. 2026

DATV část (maják na C3, příjem přes S3, Android aplikace) je realizovaná a na GitHubu
jako ok1cdj/ESP32-ATV. Úzkopásmový CW/SSB/OOK48 provoz popsaný v tomto dokumentu je zatím koncept.

**Předpoklad: nejdřív TCXO.** Bez stabilní reference nemá úzkopásmový provoz smysl
(viz kapitola 2). Začít jinak než CW s AFC nedává smysl.

---

## 1. Cíl

Úzkopásmová stanice pro 13 cm (segment kolem 2320,0–2320,2 MHz, volací 2320,200)
na stejném principu jako DATV v ESP32-ATV:

- **TX:** XIAO ESP32-C3 (nebo C3 SuperMini), I/Q DAC řízený z CPU (trik SP8ESA).
- **RX:** XIAO ESP32-S3 (Plus), surová I/Q přes USB (ESP-SDR / ESP32-DATV-RX).
- **Ovládání:** nejdřív **webová aplikace na PC** (Web Serial, Chrome/Edge) jako test bench
  a referenční UI; Android aplikace zatím ne (později ze stejného jádra přes NDK).
- **Módy:** CW, SSB, OOK48.

Využití: SOTA, rain scatter, příjem a test majáků, levná alternativa k transvertoru.

---

## 2. Proč je stabilita hlavní problém

Dnešní stav s krystalem: odchylka C3 **+21 až +38 kHz**, mění se během minut (zahřívání).

| Mód | Potřebná stabilita | S krystalem | S TCXO ±0,5 ppm |
|---|---|---|---|
| CW | desítky Hz | nepoužitelné bez AFC | OK |
| SSB | ~50 Hz (srozumitelnost) | nepoužitelné | OK (statiku doladit ručně) |
| FT8 | ~1 Hz během 15 s | nepoužitelné | nutná korekce z 1 PPS |

TCXO ±0,5 ppm ≈ ±1,2 kHz na 2320 MHz (statická chyba, doladitelná), drift prakticky zmizí.

---

## 3. TCXO – návrh a úprava desek

### Kmitočty krystalů

| Čip | Krystal | Poznámka |
|---|---|---|
| ESP32-C3 | 40 MHz | firmware podporuje jen 40 MHz |
| ESP32-S3 | 40 MHz | |
| ESP32-C5 | 48 MHz | firmware jen 48 MHz, Espressif vyžaduje ±10 ppm |

### Zapojení

- TCXO **40,000 MHz** (pro C5 48,000 MHz), **clipped sine**, 3,3 V, ±0,5 až ±2,5 ppm, pouzdro 2520/3225.
  Pozor při nákupu: nejběžnější jsou 26 MHz (GSM).
- Výstup přes **oddělovací kondenzátor na XTAL_P**, XTAL_N volný.
- Amplituda na XTAL_P **max. 1,1 V** (Espressif) – clipped sine (~0,8 Vpp) vyhovuje,
  CMOS 3,3 V by potřeboval dělič.
- **Vlastní nízkošumové LDO** jen pro TCXO; blokování 100 nF + 10 nF u napájecího pinu.
- Hodnotu vazebního kondenzátoru ověřit v hardware design guidelines daného čipu.
- U C5 guidelines výslovně uvádějí jen krystal – externí oscilátor ověřit v plném dokumentu.

### Úprava desek

- **XIAO C3 i XIAO S3 mají kovový stínicí kryt** – nutné ho sundat horkým vzduchem
  (a nechat dole, nebo počítat s horším stíněním).
- **C3 SuperMini nemá kryt** – nejsnazší platforma pro první test (SP8ESA na něm vyvíjel).
  Chybí U.FL, keramickou anténu lze nahradit pigtailem.
- Footprint krystalu nejde použít přímo (krystal má na dvou padech zem, TCXO potřebuje napájení)
  → TCXO „dead-bug“ s krátkými vodiči, nebo malá adaptérová destička.
- Spoj k XTAL_P co nejkratší (ideálně tenký koax) – rušení se promítne do fázového šumu na 2,3 GHz.
- Teplo z majáku TCXO nevadí, pokud je v pracovním rozsahu (typicky do +85 °C);
  vadí jen rychlé teplotní změny. Zabalení do izolace nepřichází v úvahu.

### Testovací deska TCXO (samostatně)

- TCXO + LDO + blokování + vazební C.
- Footprint na **odporový dělič / útlumový článek** pro doladění amplitudy.
- **Testovací výstup U.FL** pro Rigol (kmitočet, úroveň, harmonické).
- Footprint univerzální pro 40 MHz i 48 MHz (C5).

### Postup ověření

1. První test na C3 SuperMini, pak XIAO.
2. Log odchylky před a po úpravě přes `rx_dvbs2.py` (30 min od studeného startu).
3. Rigol: fázový šum nosné s krystalem vs. s TCXO.

### TCXO na přijímači (S3)?

Pro samotný příjem méně důležité (leandvb / AFC dorovná). Smysl má, pokud má S3 sloužit
jako **kmitočtová reference** (kalibrace ppm vysílače) – pak musí být přesnější než vysílač.
Priorita: TCXO nejdřív na C3.

---

## 4. TCXO + 1 PPS (přesný kmitočet na stupnici)

Nejlepší poměr výsledek/složitost:

- **TCXO** dává čistý signál a malý drift.
- **1 PPS z GPS** změří zbývající statickou chybu, C3 ji opraví.

Protože TCXO skoro nedriftuje, **není potřeba sledování v reálném čase**:

1. Po startu, **před zapnutím TX**, C3 počítá tiky svých hodin mezi pulzy PPS (10–30 s)
   → chyba TCXO s přesností na setiny ppm.
2. Statická korekce při nastavení LO (mechanismus `--ppm` existuje v PC režimu ESP32-DATV;
   pro maják případně přidat příkaz `PPM` s uložením do NVS, podobně jako `BDC`).
3. Volitelně jednou za hodinu krátká pauza TX (10–30 s) na přeměření.

Výsledek: bez GPS ±1–6 kHz (jen TCXO), s PPS řádově stovky Hz nebo méně.
Hardware: TCXO + jeden vodič z PPS na volný GPIO; stačí levný u-blox (NEO-6M/M8N).

**Ověřit ve firmwaru:** korekce ppm v cestě nastavení LO (rozlišení) a měření PPS
čítačem / přerušením se systimerem před spuštěním vysílací smyčky.

### Proč ne přímo výstup u-bloxu (TIMEPULSE)

- Běžné u-bloxy (M8) dávají na timepulse jen jednotky MHz (ověřit v datasheetu), potřeba je 40 MHz.
- Timepulse je kvantovaný na vnitřní hodiny přijímače → **jitter**, PLL ho násobí ~58×
  na 2340 MHz → fázový šum a parazitní čáry.

### Alternativa pro pevný maják: GPSDO

u-blox + VCTCXO 40 MHz (hotové nebo vlastní: timepulse 1 PPS–kHz, MCU počítá periody,
DAC ladí VC). Výstup přes C a dělič na XTAL_P (≤ 1,1 V).

### Softwarová teplotní kompenzace (experiment bez HW)

C3 má vestavěný teplotní senzor → křivka odchylka(T) do NVS, firmware dolaďuje.
Nejistoty: senzor měří čip, ne krystal (zpoždění); není jisté, že maják umí jemně
přelaďovat za běhu.

---

## 5. TX na C3

### CW

- **NCO na offsetu od LO** – signál mimo zbytkový únik nosné + jemné ladění po Hz
  (PLL ladí hrubě).
- **Tvarovaná obálka klíčování** (raised cosine, ~5 ms náběh/doběh) proti key clicks.
- Klíč / pádlo na GPIO, nebo z aplikace (USB/BLE).
- Výkon ~0 dBm (odhad, změřit) – pro CW stačí jakýkoli PA.

### SSB

- S I/Q přirozeně: **I = audio, Q = Hilbertova transformace audia**, znaménko určuje USB/LSB.
- Hilbertův FIR na 8 kS/s je pro C3 lehký, k tomu interpolace na rychlost DAC.
- Audio z telefonu/PC přes USB (stejná cesta jako dnes pro symboly) nebo mikrofon na ADC C3.
- **PA musí být lineární** (odstup od P1dB jako u DVB-S2).

---

## 6. RX na S3

- **Hned bez nového kódu:** rtl_tcp z ESP32-ATV (`127.0.0.1:1234`), S3 na 2320 MHz,
  SDR++ / SDRangel v režimu SSB/CW.
- **Na čipu:** SSB/CW demodulace na zvukových kmitočtech je výpočetně levná (na rozdíl od LDPC)
  – zvuk přes I2S DAC do sluchátek nebo USB do telefonu. Tady DSP na S3 dává smysl.

---

## 7. OOK48 (TX i RX)

Mód od G4EML (fork pro RP2040 s LCD: VK4MJF, https://github.com/vk4mjf/RP2040_OOK48_LCD),
navržený pro mikrovlnná pásma a slabé signály.

### Princip

- Klíčování zapnuto/vypnuto (OOK) – na mikrovlnách jednodušší než FSK; datová rychlost
  podobná telegrafii, hotový OOK48 modul jde připojit na CW klíčovací vstup rádia.
- Každý znak = kód **„4 z 8“** (8 bitových pozic, vždy právě 4 zapnuté).
- **1 znak za sekundu** (volitelně 2 s), začátek každého znaku synchronizovaný **GPS 1 PPS**.
  Obě strany musí mít stejnou délku znaku.
- Zpráva se zobrazuje znak po znaku v reálném čase (žádné čekání jako u WSJT).
- Dekódování ze zvuku CW/SSB přijímače: spektrum 500–1100 Hz, dekódovací pásmo kolem 800 Hz.
- Typické zprávy: značka + lokátor (VK4MJF verze počítá lokátor z GPS, 6/8/10 znaků).

### TX (C3)

- **Časování dělá C3 sám** podle vlastního GPS 1 PPS (stejný PPS jako pro korekci TCXO,
  kapitola 4): 8 bitových slotů po ~110 ms od náběžné hrany PPS, přesnost na jednotky ms.
- Klíčování přes stávající CW cestu (NCO + tvarovaná obálka, kapitola 5).
- Aplikace jen pošle **text zprávy** a nastavení (délka znaku, kmitočet) přes USB;
  časově kritickou část telefon nedělá (jitter plánování Androidu).
- Kodér „4 z 8“ (tabulka znaků podle G4EML) přímo ve firmwaru C3.
- Volitelně režim **maják**: opakovaná zpráva (značka + lokátor) uložená v NVS, bez telefonu.
- Záloha bez nového kódu: hotový OOK48 modul (RP2040 + GPS) na klíčovací vstup C3.

### RX (S3 + aplikace)

- S3 posílá I/Q přes USB jako dnes (ESP32-DATV-RX), aplikace dělá:
  1. USB demodulaci, tón kolem 800 Hz;
  2. spektrum + vodopád 500–1100 Hz s vyznačeným dekódovacím pásmem;
  3. OOK48 dekodér (integrace energie v 8 bitových slotech, výběr nejlepší kombinace 4 z 8);
  4. zobrazení znaků v reálném čase, log zpráv.
- **Časová synchronizace přijímače** (dekodér musí znát začátek sekundy):
  - **GPS 1 PPS na S3** – S3 označí vzorky časovou značkou PPS (nejspolehlivější), nebo
  - **GNSS hodiny telefonu** (Android GnssClock, přesnost lepší než ms). Běžný systémový
    čas Androidu (NTP) nestačí.
- Kmitočtová tolerance: tón musí zůstat v dekódovacím pásmu kolem 800 Hz →
  TCXO s ručním doladěním nejspíš stačí, TCXO + korekce z 1 PPS s rezervou.
  S holým krystalem ne.

### Aplikace: TRX na jedné obrazovce

Nejdřív jako **webová aplikace na PC** (viz kapitola 12, krok 6), stejné rozvržení později
pro Android.

Na rozdíl od ATV aplikace (oddělené záložky RX a TX) jde o transceiver, takže RX i TX
na jedné obrazovce, shora dolů:

1. **Stavový řádek:** kmitočet, mód (CW / SSB / OOK48), stav TX/RX, synchronizace
   (PPS / GNSS), korekce ppm z C3, připojení obou desek.
2. **Spektrum + vodopád** (500–1100 Hz pro OOK48, širší pro CW/SSB) s vyznačeným
   dekódovacím pásmem; úseky vlastního vysílání ve vodopádu označené.
3. **Okno zpráv** (jako chat): přijaté znaky v reálném čase, vlastní odeslané zprávy
   barevně odlišené, čas UTC, log.
4. **TX lišta:** přednastavené zprávy (značka, lokátor z GPS telefonu, RRR, 73…),
   pole pro vlastní text, délka znaku 1/2 s.
5. **Velké tlačítko TX/RX** (PTT), volitelně automatické střídání po periodách.

Provoz:

- **Half-duplex:** při vysílání C3 se přijímač S3 utlumí nebo přestane dekódovat
  (vlastní signál by ho přebudil), po skončení TX se dekodér znovu zasynchronizuje.
- Ovládání přepínání TX/RX a sekvencování PA přes C3 (GPIO), aplikace jen dává povel.
- Ladění společné pro RX i TX (TX na kmitočtu RX, volitelně RIT/offset).
- Sdílet co nejvíc kódu s ATV aplikací (USB obsluha, výběr zařízení podle MAC, flashování C3).

### Proč OOK48

- Jednoduchý vysílač (jen klíčování), citlivý příjem slabých signálů – funguje i hluboko v šumu,
  kde CW okem nestačí.
- Vhodné pro tropo spoje, rain scatter a **maják se značkou a lokátorem**.
- 1 PPS na vysílači se využije dvakrát: korekce TCXO i časování OOK48.

---

## 8. Projekt SP8ESA: ESP8266_2.4GHz_SSB_TRX (MIT)

https://github.com/SP8ESA/ESP8266_2.4GHz_SSB_TRX

Slouží jen jako zdroj nápadů a MIT kódu, testovat ho nebudeme.

### Co umí

- **TX polární metodou (Kahn, EER):** interní generátor testovacího tónu PHY;
  obálka = digitální atenuátor (ASK ~0,24 dB/krok), okamžitý kmitočet = offset tónu
  (78,125 kHz/kód, frakční K ditheringem). SSB 32 kS/s z PC přes USB-UART 2 Mbaud nebo z flash.
- **RX:** hardwarový estimátor DC/IQ (kalibrační blok Wi-Fi RX) → spojité komplexní vzorky
  ~35,7 kS/s; low-IF režim (~500 kS/s, NCO, CIC). → **jednočipový half-duplex SSB TRX.**
- LO 2300–2600 MHz v krocích 1/1024 MHz (fractional-N) – segment 2320 pokrytý.
- Testovací zdroje: dvoutón, šum, sinus, CW.

### Slabiny

- ASK rozsah jen ~31 dB → ořez obálky, omezená dynamika SSB.
- Při streamování čáry od USB-UART na ±153 kHz, ~−19 dB vůči signálu (z flash ne).
- Obrazy vzorků na ±32 kHz.
- Streamování s vypnutými přerušeními (citlivé na časování).

### Proč dlouhodobě ESP32 (C3 TX + S3 RX)

- **Skutečný I/Q DAC** – kartézská modulace místo polární: bez limitu dynamiky obálky,
  bez AM-PM zkreslení, jednodušší DSP.
- **Nativní USB** místo CH340 – čáry od UART by měly zmizet (ověřit na Rigolu).
- **Hotový ekosystém:** DC kalibrace, rtl_tcp, Android aplikace.
- Víc výkonu CPU na DSP na čipu.

### Co převzít (MIT – lze i do GPL repa)

- DSP řeči `ssb_dsp.py` (pásmová propust, kompresor, limiter).
- Testovací zdroje pro měření IMD a nežádoucích produktů.
- **Nápad: estimátor DC/IQ na C3** – pokud C3 má podobný blok, šel by spojitý úzkopásmový
  příjem přímo na C3 (ESP-SDR na C3 dnes jen snapshoty) → C3 jako jednočipový half-duplex TRX
  s lepším vysíláním než ESP8266. Prozkoumat.

---

## 9. RF okolí

- **Pásmová propust** nutná (obrazy DAC, harmonické).
- Přepínání **TX/RX** a sekvencování s PA – viz níže.
- Fázový šum PLL Wi-Fi čipu je pro tiché 13cm pásmo pravděpodobně přijatelný – změřit na Rigolu.
- Kalibrace DC (potlačení LO) platí pro jeden kmitočet – pro 2320 MHz zkalibrovat zvlášť.

### Přepínač TX/RX (polovodičový, 1–2 W)

Místo SMA relé polovodičový SPDT spínač. Hlavní parametr je **izolace TX→RX** – chrání
vstup S3 během vysílání.

**Kandidáti od ADI (pouzdro 4×4 mm LFCSP, neodrážející SPDT):**

| | HMC8038 (doporučeno) | HMC349A | HMC849A |
|---|---|---|---|
| Technologie | křemík | GaAs | GaAs |
| Pásmo | 0,1–6 GHz | 100 MHz – 4 GHz | DC – 6 GHz |
| Izolace | ~60 dB (až 62 dB do 4 GHz) | 62 dB do 2 GHz | až 60 dB |
| Vložný útlum | 0,8 dB | 1,0 dB do 2 GHz | 0,8 dB |
| Zatížitelnost – průchozí cesta | 34 dBm (P0.1dB 35 dBm při 5 V) | 33,5 dBm při VDD 5 V | ověřit v datasheetu |
| Zatížitelnost – terminovaná cesta | 29 dBm | 26,5 dBm | ověřit v datasheetu |
| Napájení | | 3–5 V, ale při 3 V P1dB jen 28 dBm → **nutně 5 V** | |
| LCSC | C208270 | C207982 | |

- **HMC8038:** největší rezerva v obou cestách, nejlepší volba pro 2 W.
- **HMC349A:** **pinově kompatibilní s HMC8038** → jeden footprint, osadit kterýkoli.
  Na 1 W v pohodě, na 2 W (33 dBm) na hraně zatížitelnosti a bez rezervy.
- **HMC849A:** smysl, pokud by stejný spínač měl sloužit i pro **6 cm** (C5) – rozsah do 6 GHz;
  výkonovou zatížitelnost před použitím na 2 W ověřit.
- **Návrh desky:** footprint pro HMC8038/HMC349A, osadit HMC8038, HMC349A jako záloha
  nebo levnější varianta pro 1 W.

**Další varianty (Skyworks):**

| Spínač | Pásmo | Zatížitelnost | Izolace | Útlum | Poznámka |
|---|---|---|---|---|---|
| SKY13348-374LF | 0,5–6 GHz | IP1dB +37 dBm, lineárně až 7 W | jen 27 dB @ 2,5 GHz | – | levný, ale bez dalšího omezovače nevhodný |
| SKY12241 / SKY12242 | TDD LTE (2,3 GHz+) | 50 W / 100 W | 51 dB @ 2,6 GHz | 0,29 / 0,52 dB (TX/RX) | integrovaný budič, 5 V, logika 0–3 V; pro budoucí vyšší výkon |

Výpočet ochrany přijímače při PA 33 dBm:

- HMC8038 (60 dB): na S3 přijde ~−27 dBm → bezpečné.
- SKY13348 (27 dB): na S3 přijde ~+6 dBm → riziko poškození vstupu.

Zásady zapojení:

- **Sekvencování (nejdůležitější):** RX→TX: nejdřív přepnout spínač, pak zapnout PA.
  TX→RX: nejdřív vypnout PA, pak přepnout spínač. Žádné přepínání pod výkonem (hot switching).
  Řídí C3 přes GPIO s prodlevou několika ms; aplikace dává jen povel.
- **Pozor na terminovanou cestu:** snese výrazně méně než průchozí (HMC8038 29 dBm,
  HMC349A 26,5 dBm). Pokud PA vysílá do vypnutého portu (chyba sekvencování),
  **2 W zničí oba spínače**. Pojistky:
  - zapnutí PA **hardwarově podmíněné stavem spínače** (logika / tranzistor, ne jen software);
  - případně omezit PA na ~1 W – pak je rezerva i v terminované cestě HMC8038.
- **Zvolené řešení: časování v C3 + minimální hardwarová pojistka na desce**
  - **Firmware C3** dělá celé sekvencování (t1, t2 nastavitelné v kódu):
    RX→TX: CTRL_TX=1 → čekat t1 → PA_REQ=1 → pustit RF z C3.
    TX→RX: zastavit RF z C3 → PA_REQ=0 → čekat t2 → CTRL_TX=0.
  - **Na desce:** pull-downy na CTRL_TX a PA_EN (bez signálu = RX, PA vypnutý)
    a jedno hradlo **AND (74LVC1G08): PA_EN = PA_REQ AND CTRL_TX** – PA nejde zapnout,
    pokud spínač není povelem v TX, ať firmware dělá cokoli.
  - Hradlo **neohlídá pořadí při návratu do RX** (současné přepnutí = krátký hot switch) –
    pořadí a t2 musí dodržet firmware; hradlo je záchrana pro pád, reset a boot.
  - Firmware: piny bez strappingu (ne GPIO2/8/9) a bez impulzů při bootu (ne USB GPIO18/19);
    sekvenci TX→RX dokončit i v obsluze chyb (před restartem nejdřív vypnout PA);
    RF z C3 pouštět až po zapnutí PA a vypínat před přepnutím zpět.
  - Pozor na logické úrovně: 74LVC napájené 5 V nemusí spolehlivě brát 3,3 V vstupy
    (VIH ≈ 0,7·VCC) → hradlo napájet 3,3 V; ověřit prahy řídicího vstupu spínače při VDD 5 V.
- Vložný útlum na RX straně (HMC8038 ~0,8 dB) se přičte k NF. **LNA za spínač** na RX stranu;
  při dlouhém koaxu spínač + LNA přímo u antény.
- Oddělovací kondenzátory na všech RF portech (podle datasheetu).
- **Pojistka přijímače:** omezovač nebo PIN dioda před S3 pro případ chyby sekvencování.
- Při zvýšení výkonu nad ~2 W přejít na SKY12241.

### Jednočipový TRX (jen C3) vs. dvoudesková sestava (C3 + S3)

Jednočipový TRX (pokud se ověří příjem na C3 přes estimátor DC/IQ, kapitola 8) má **jeden RF pin**
pro TX i RX → kvůli PA a LNA jsou potřeba **dva přepínače**:

```
C3 (RF pin) → spínač 1 (malý výkon) ─┬→ PA → spínač 2 (HMC8038) → filtr → anténa
                                     └← LNA ←──────┘
```

- **Spínač 1 u čipu:** jen ~0 dBm → stačí levný malý SPDT. Izolace se sčítá se spínačem 2
  (výhoda pro ochranu LNA).
- **Spínač 2 u antény:** HMC8038 (viz výše).
- **Sekvencování** složitější: oba spínače, PA a navíc **vypnutí LNA během TX**.

**Dvoudesková sestava (C3 TX + S3 RX)** tento problém nemá – každý čip má vlastní cestu,
stačí jen spínač u antény. Jednočipový TRX ušetří desku, ale přidá spínač; cenově podobné.

**Alternativa: integrovaný 2,4GHz front-end modul (FEM)**

- PA + LNA + T/R spínače v jednom pouzdře s **jedním společným portem** pro čip
  (určené pro SoC s jedním RF pinem – Bluetooth, Zigbee); výkon typicky ~+20 dBm.
- Na 1–2 W nestačí, ale jako budič + LNA by zjednodušil celou RF část na jeden čip.
- **Pozor:** FEM jsou specifikované na 2400–2483 MHz – na 2320 MHz může klesnout zisk,
  NF i přizpůsobení → změřit Rigolem s TG. Pro **QO-100 uplink (2400 MHz)** by seděly přesně.

**Shrnutí:**

- 2320 MHz, 1–2 W: dva spínače, diskrétní PA a LNA.
- 2400 MHz (QO-100), nižší výkon: zvážit FEM.
- Dokud není ověřený příjem na C3, je jednodušší cestou **dvoudesková sestava**.

### Pásmová propust: pipe-cap filtr na 2320 MHz

Jednoduchá výroba z instalatérského měděného víčka, ladí se šroubem, 1–2 W bez problémů.
Princip: čtvrtvlnný koaxiální rezonátor, ladicí šroub = střední vodič, kapacitně zatížený
mezerou mezi koncem šroubu a deskou.

**Zapojení – jeden filtr pro TX i RX:**
anténa → pipe-cap filtr → T/R spínač (HMC8038) → PA / LNA.
Útlum filtru (~0,5–1 dB) se přičte k NF i ke ztrátě výkonu; výměnou je ochrana LNA
před přebuzením od Wi-Fi.

**Odhad délky šroubu** (víčko 28 mm / 1", hrubý model; skutečnou vnitřní výšku víčka změřit):

| Vnitřní výška dutiny | Šroub M5 | Šroub M6 | Šroub M8 |
|---|---|---|---|
| 20 mm | 19,5 mm (mezera 0,55) | 19,3 mm (0,71) | 19,0 mm (1,0) |
| 22 mm | 21,3 mm (0,72) | 21,1 mm (0,92) | 20,7 mm (1,3) |
| 25 mm | 23,9 mm (1,1) | 23,6 mm (1,4) | 23,1 mm (1,9) |
| 30 mm | 27,4 mm (2,6) | 26,9 mm (3,1) | 26,2 mm (3,8) |

Rozměr = jak daleko šroub zasahuje do dutiny; v závorce mezera konec šroubu – deska.

- λ/4 na 2320 MHz = 32,3 mm; běžné 28mm víčko je vnitřně mělčí (~20–25 mm) → mezera
  jen 0,5–2 mm → **citlivé ladění** (potvrzují to i realizace níže), horší teplotní stabilita.
- Doporučení: **silnější šroub (M8)** a/nebo **prodloužit dutinu** kusem 28mm trubky na vnitřní
  výšku ~30–35 mm → mezera ~4–7 mm, klidné ladění, vyšší Q.
- Pro 2320 MHz bude šroub o kousek hlouběji než u realizací na 2400 MHz (QO-100).

**Startovní rozměry podle realizací:** rozteč sond 16–18 mm, délka sond začít na 10–12 mm
a zkracovat (kratší sonda = užší pásmo, vyšší útlum).

**Odhad odezvy** (Q nezatížené ~2000):

| Filtr | Šířka −3 dB | Útlum v pásmu | Potlačení na 2400 MHz (Wi-Fi) | Na ±8 MHz (obrazy DAC) |
|---|---|---|---|---|
| 1 dutina | 40 MHz | ~0,3 dB | ~12 dB | ~0,5 dB |
| 1 dutina | 20 MHz | ~0,5 dB | ~18 dB | ~2 dB |
| 2 dutiny | 30 MHz | ~0,8 dB | ~29 dB | ~1 dB |

- Proti Wi-Fi **dvě dutiny** – nejjednodušeji dva jednodutinové filtry spojené krátkým koaxem
  (útlumy se zhruba sečtou, možné zvlnění od nepřizpůsobení).
- Obrazy DAC na ±8 MHz pipe-cap prakticky neovlivní (řeší je zero-order hold DAC – změřit).
- **Harmonické:** pipe-cap může mít parazitní propustnost na vyšších kmitočtech →
  na TX straně přidat **dolní propust** (např. koaxiální LPF podle DJ0ABR), nebo proměřit VNA do ~7 GHz.
  Rigol (do 3 GHz) harmonické na 4640 MHz neuvidí.

**Ladění s tracking generátorem (Rigol DSA1030 + TG):**

1. Normalizace: TG → propojovací kabel → vstup, uložit jako referenci (thru).
2. Vložit filtr, rozmítání 2,2–2,5 GHz.
3. Šroubem nastavit maximum na 2320 MHz.
4. Sondy upravit na požadovanou šířku a minimální útlum; po každé změně sond doladit šroub.
5. U dvou dutin naladit každou zvlášť, pak dohromady doladit tvar.
6. Zajistit šroub kontramatkou, zkontrolovat teplotní stabilitu (nahřát fénem).

**Konstrukční tip (G4HSK):** vyvrtat a vyříznout závit do víčka, ocelovým šroubem přidržet
mosaznou matici při pájení, pak ocelový šroub vyšroubovat.

**Realizace a zdroje:**

- G4HSK – 2400 MHz pipe-cap pro QO-100 (28mm víčko, RG402, šroub M4):
  https://radio.g4hsk.co.uk/2020/01/04/qo-100-experiments-2400mhz-pipe-cap-filter/
- 9A Croatia microwave – 13cm pipe-cap (1" víčko, M5, sonda 10 mm, rozteč 18 mm,
  útlum 2,85 dB, −32 dB na ±144 MHz, citlivé ladění):
  http://croatia-microwave.blogspot.com/2010/12/13cm-pipe-cap-filter.html
- M1KTA – 13cm pipe end cap filtr (1" víčko, RG402, rozteč sond 16 mm, sondy ~8 mm):
  http://m1kta-qrp.blogspot.com/2021/01/new-13cm-pipe-end-cap-filter.html
- KO4BB – Pipe Cap Filters (doporučováno na fóru AMSAT-DL):
  http://www.ko4bb.com/ham_radio/Pipe_Cap_Filters/
- W1GHZ – Improvements for Transverters with Pipe-Cap Filters (vliv délky sond, ladění, ¾" víčka):
  https://www.w1ghz.org/xvtr/Improvements_for_Transverters_with_Pipe-Cap_Filters.pdf
- EA4NZ – 10 GHz pipe-cap, měření vlivu délky sondy a propustnosti na vyšších kmitočtech:
  https://ea4nz.ure.es/pipecap/pipecap.html
- DJ0ABR – koaxiální dolní propust 2,4 GHz pro velké výkony (proti harmonickým):
  https://projects.dj0abr.de/doku.php?id=en:sat:filter2400

---

## 10. Měření (Rigol DSA1030, do 3 GHz)

- Výkon C3 (CW) a pracovní bod PA.
- Fázový šum nosné: krystal vs. TCXO.
- SSB dvoutón (IMD) a šum (nežádoucí produkty).
- Čáry od USB provozu, obrazy DAC, únik LO.
- Harmonické nad 3 GHz Rigol neuvidí.

---

## 11. Licence

- ESP8266 projekt: **MIT** – bez omezení.
- Trik s I/Q DAC na C3 pochází z ESP32-DATV (**PolyForm Noncommercial**): firmware na něm
  postavený zůstane nekomerční (pro ham OK), nebo mechanismus nezávisle implementovat podle
  popisu (fakta a metody chráněné nejsou, jen kód).
- Nemíchat PolyForm kód s GPL částmi ESP32-ATV.
- **OOK48:** licenci firmwaru G4EML / VK4MJF ověřit v repozitářích, než se převezme kód
  kodéru nebo dekodéru do aplikace nebo firmwaru.

---

## 12. Plán

**Zásady:**

- Vysílání i příjem se nejdřív ověří na PC: simulace, skripty a **webová aplikace**
  (stejný postup jako u ESP32-ATV: nejdřív PC, pak mobil).
- **Android aplikaci zatím stavět nebudeme.** Později ji půjde postavit ze stejného jádra (NDK).
- **Jedno DSP jádro v C/C++, tři cíle:** WebAssembly (webová aplikace), Python wrapper
  (simulace, testy), později Android NDK. Žádný přepis mezi jazyky.

1. ✅ **TCXO** – funkční. *Zbývá změřit a zapsat:* 30min log odchylky od studeného startu
   (před/po), statická odchylka, fázový šum na Rigolu proti krystalu.
   Zapojení: TCXO 40 MHz clipped sine → **10 pF C0G** → XTAL_P, XTAL_N volný, amplituda ≤ 1,1 V.
2. ⬜ **NB krok 1 – CW maják a příjem** (*další krok*, zadání: `zadani-cw-krok1.md`):
   - C3 jako **CW maják** (NCO offset, tvarované klíčování, text + dlouhá nosná, NVS) =
     testovací zdroj signálu;
   - **spektrum** z PC: tinySA Ultra+ ZS-407 (USB), případně Rigol DSA1030 (SCPI) –
     kmitočet, drift 30 min, únik LO, klíčování, nežádoucí produkty;
   - **příjem na stávajících skriptech ESP32-ATV** (S3, rtl_tcp → SDR++, záznam I/Q)
     + Python analýza a jednoduchý CW dekodér.
3. ⬜ **CW TX na C3 – provozní verze:** klíčovací vstup (pádlo/klíč), ovládání z PC.
4. ⬜ TCXO + **1 PPS** korekce (příkaz `PPM`, NVS).
5. ⬜ **OOK48 TX na C3:** kodér 4 z 8 (*kodér už je napsaný*), časování od PPS, režim maják.
6. 🟨 **DSP jádro a testy na PC – vysílání i příjem** (*OOK48 kodér a dekodér hotové*,
   zbývá CW/SSB demodulace, AFC, simulace a testy na hardwaru):
   - **Jádro v C/C++** jako čistá knihovna bez I/O: demodulace CW/SSB, AFC,
     OOK48 kodér a dekodér. Sdílené **testovací vektory (JSON)**.
   - **Python wrapper:** simulace bez hardwaru (OOK48/CW se šumem, driftem a časovým
     posunem), měření prahu citlivosti, regresní testy nad JSON vektory.
   - **TX:** ovládání C3 z PC (CW, OOK48 zprávy, kmitočet, `PPM`, stav PPS); měření na Rigolu
     (výkon, tvar klíčování, spektrum, nežádoucí produkty, sekvencování T/R spínače a PA).
   - **RX:** I/Q ze S3, dekódování vlastního C3 přes útlum i na trase; synchronizace
     z časových značek PPS vložených S3 do streamu.
   - Výsledky do docs/ (práh, tolerance driftu a časování).
7. ⬜ **Webová aplikace NB TRX na jedné obrazovce (PC test bench):**
   - **Web Serial** (Chrome/Edge, HTTPS nebo localhost): S3 (I/Q) a C3 (řízení TX) najednou.
   - Jádro z kroku 6 zkompilované do **WebAssembly** (musí projít stejnými JSON vektory).
   - Vodopád (canvas/WebGL), zvuk přes Web Audio (AudioWorklet), okno zpráv, TX lišta, PTT.
   - Časování OOK48: TX dělá C3 podle PPS; RX podle PPS značek ze S3
     (hodiny prohlížeče/NTP nejsou dost přesné).
   - Hostování na GitHub Pages / ok1cdj.com (vedle FT8Web, WSPR Lab).
   - Omezení: jen Chromium prohlížeče; Web Serial na Androidu zatím neověřený.
8. ⬜ **SSB TX na C3** (Hilbert I/Q, DSP řeči převzaté z MIT projektu), lineární PA –
   ověřit na PC (dvoutón, IMD na Rigolu); mikrofon ve webové aplikaci přes `getUserMedia`.
9. ⬜ **Jednočipový TRX na C3, případně na S3** (průzkum varianty S3 je součástí NB kroku 1).
   **C3:** SP8ESA ukázal spojitý příjem na C3 (úzké signály posílá jako
   I/Q, široké demoduluje na čipu a posílá symboly) → zeptat se ho na postup místo hledání
   estimátoru DC/IQ. Pokud se ověří: RF část se dvěma spínači (u čipu + u antény)
   a vypínáním LNA při TX, případně FEM pro 2400 MHz.
10. ⏸ *(Později)* **Android aplikace** ze stejného jádra (NDK) a stejného rozvržení obrazovky.

### Paralelní linie a hardware

- **OOK48 přes IC-705 (keyer, CW cesta):**
  - ⬜ webový přijímač OOK48 – zadání: `zadani-ook48-web-rx.md`;
  - ⬜ originál G4EML/VK4MJF jako reference (kompatibilita a srovnání citlivosti);
  - ⬜ úprava ESP32 keyeru pro TX (BLE, synchronizace hodin, klíčování z GPTimer) – navazující úkol;
  - vylepšení dekodéru: `ook48-dekoder-vylepseni.md`.
- **Hardware:**
  - ⬜ deska T/R spínače (HMC8038) – zadání: `zadani-tr-spinac.md`;
  - měření: tinySA Ultra+ ZS-407 (ovládání z PC, případně harmonické nad 3 GHz),
    Rigol DSA1030 + TG (do 3 GHz, ladění filtrů);
  - ⬜ pipe-cap filtr 2320 MHz (ladění s tracking generátorem, kapitola 9);
  - ⬜ PA 1–2 W (pracovní bod podle MER a ramen, kapitola 9).

Legenda: ✅ hotovo · 🟨 rozpracováno · ⬜ nezačato · ⏸ odloženo
