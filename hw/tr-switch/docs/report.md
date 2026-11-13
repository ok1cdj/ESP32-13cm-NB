# T/R přepínač 13 cm (HMC8038 / HMC349ALP4CE) – report

Stav: kroky 0–3 schválené, **deska objednána u JLCPCB (21. 10. 2026)**. Krok 4 je plán měření pro osazené desky (kap. 4).

Pozn.: report vznikl nezávisle na [`docs/nb-cw-ssb-13cm.md`](../../../docs/nb-cw-ssb-13cm.md) (kap. 9), nečerpá z něj.

## 0. Průzkum datasheetů

### Zdroje
| dokument | revize | odkaz |
|---|---|---|
| HMC8038 datasheet | Rev. A (11/2015) | https://www.analog.com/media/en/technical-documentation/data-sheets/hmc8038.pdf |
| HMC8038W (automotive, stejný čip) | Rev. 0 (8/2017) | https://www.analog.com/media/en/technical-documentation/data-sheets/HMC8038W.pdf |
| HMC349ALP4CE datasheet | Rev. B (1/2019) | https://www.analog.com/media/en/technical-documentation/data-sheets/hmc349alp4ce.pdf |
| pouzdro CP-16-40 | 10-19-2015-A | https://mds.analog.com/api/public/content/cp-16-40.pdf |
| EVAL HMC8038 (Gerbery 600-01267-00) | – | https://www.analog.com/media/en/technical-documentation/evaluation-documentation/gerber-files/HMC8038LP4CE_Gerbers.zip |
| EVAL stránka | – | https://www.analog.com/en/resources/evaluation-hardware-and-software/evaluation-boards-kits/eval-hmc8038.html |

Pozor na název: **HMC349A** v LFCSP je **HMC349ALP4CE** (GaAs). HMC349AMS8G je MSOP-8 a pinově
nesedí. Starší Hittite verze v01.0314 se od Rev. B liší (např. P1dB 31 dBm), platí Rev. B.

### Pinout a kompatibilita
Oba čipy mají stejné pouzdro (CP-16-40, 4×4 mm, rozteč 0,65 mm, EP 2,40 mm □) a stejný pinout.
HMC349ALP4CE Rev. B uvádí výslovně „Pin-compatible with the HMC8038“ (str. 1).
HMC8038 uvádí kompatibilitu s HMC849ALP4CE.

| pin | HMC8038 | HMC349ALP4CE | zapojení na desce |
|---|---|---|---|
| 1 | VDD | VDD | +5 V, 100 pF + 100 nF |
| 2 | VCTL | CTRL | CTRL_SW (z CTRL_TX přes R), 100 pF na GND |
| 3 | RFC | RFC | ANT přes DC blok |
| 4, 6–8, 13–16 | NC | NIC | GND (data HMC8038 měřena s NC na zemi) |
| 5 | EN | EN | GND (natvrdo, 100 pF jako na EVAL) |
| 9 | RF1 | RF1 | **TX** přes DC blok |
| 10, 11 | GND | GND | GND |
| 12 | RF2 | RF2 | **RX** přes DC blok |
| EP | GND | GND | GND, thermal vias |

### Pravdivostní tabulka (shodná u obou)
| EN | CTRL | RFC–RF1 | RFC–RF2 |
|---|---|---|---|
| 0 | 0 | off (50 Ω term.) | **on** |
| 0 | 1 | **on** | off (50 Ω term.) |
| 1 | x | off | off – **all off, RFC reflexní** |

Z toho vychází návrh: **RF2 = RX, RF1 = TX, CTRL = CTRL_TX, EN = GND**. Ve schématu a na desce
se porty a sítě jmenují **ANT, TX, RX** (RF1/RF2 jen v odkazech na datasheet).
Pull-down na CTRL dává bez signálu RX. Stav all-off se nepoužije: HMC349A má v all-off
zatížitelnost RFC o 6 dB nižší (Rev. B, pozn. k tab. 2) a RFC je v tomto stavu reflexní.

### Rozdíly
| parametr | HMC8038 (Rev. A) | HMC349ALP4CE (Rev. B) |
|---|---|---|
| technologie | Si | GaAs MESFET |
| kmitočet | 0,1–6 GHz | 0,1–4 GHz |
| VDD | 3,0–5,4 V (doporuč.), abs. max 5,5 V | 3–5 V, abs. max 7 V |
| IDD | 0,14 mA (3,3 V) / 0,16 mA (5 V) | 1 typ / 3,5 max mA |
| VIL / VIH při 5 V | ≤ 1,20 V / ≥ 1,55 V | ≤ 0,8 V / ≥ 2 V (CMOS/TTL) |
| VIL / VIH při 3,3 V | ≤ 0,85 V / ≥ 1,15 V | stejné (0,8 / 2 V) |
| proud řídicího vstupu | < 1 µA | IINH 35 µA; vstup má 500 Ω v sérii (obr. 5) |
| abs. max řídicí vstup | −0,5 V až VDD + 0,5 V | −1 V až VDD + 1 V, **max 3 mA** |
| vložný útlum 2–4 GHz | 0,8 typ / 1,1 max dB | 1,1 typ / 1,5 max dB (do 3 GHz) |
| izolace RFC–RFx | 60 typ / 50 min dB (2–4 GHz) | 57 typ / 50 min dB (do 3 GHz) |
| ESD HBM | 4 kV (Class 3A) | **250 V (Class 1A)**, při montáži opatrně |
| θJC through / term. | 110 / 100 °C/W | 67,1 / 144,2 °C/W |

**3,3 V logika z C3 řídí oba spínače přímo i při VDD = 5 V** (VOH C3 ≈ 3,3 V > VIH 1,55 V
resp. 2 V). Převodník úrovně není potřeba.

### Zatížitelnost, kompresní body, přepínání
| | HMC8038 | HMC349ALP4CE |
|---|---|---|
| through path, 5 V | 34 dBm (TCASE −40…85 °C), 31 dBm při 105 °C | 33,5 dBm (85 °C, 0,3–4 GHz) |
| through path, 3,3 V / 3 V | 33 dBm (85 °C) | 31,5 dBm |
| terminated path | 29 dBm (25 °C) / 27 dBm (85 °C) | 26,5 dBm |
| hot switching | 27 dBm (25 i 85 °C) | 30 dBm |
| P1dB 5 V / 3,3 V(3 V) | 36 / 34 dBm | 34 / 28 dBm |
| P0.1dB 5 V / 3,3 V(3 V) | 35 / 33 dBm | 31 / 25 dBm |
| tRISE/tFALL | 60 ns | 60 ns |
| tON/tOFF | 150 ns | 150 ns |
| RF settling (0,1 dB) | 170 ns | – |
| bez napájení | – | RFC −6 dB proti through, RFx −6 dB proti terminated |

Důsledky pro PA 1–2 W (30–33 dBm):
- **5 V je správná volba pro oba čipy.** U HMC349A je to nutnost (P1dB 34 vs. 28 dBm).
  U HMC8038 dává 5 V rezervu +1–2 dB.
- 2 W = 33 dBm je u HMC349A na hranici (33,5 dBm) a u HMC8038 má rezervu 1 dB.
  Při špatném PSV antény bude špička napětí vyšší. **HMC8038 doporučuji jako osazení,
  HMC349A jen jako náhradu pro ≤ 1 W.**
- **Terminated path (27–29 dBm, resp. 26,5 dBm) je pod výkonem PA.** Pokud by PA vysílal
  do RF1 ve stavu RX, překročí se rating. Přesně tomu brání hradlo AND.
- **Hot switching 27 dBm (HMC8038)** znamená, že se nesmí přepínat, dokud je RF přítomné.
  To je čistě úkol firmwaru (t1, t2).

### Napájení a pořadí zapínání
Oba datasheety: nejdřív VDD, potom CTRL/EN, nakonec RF. HMC8038 výslovně varuje, že řídicí
vstupy pod napětím před VDD mohou otevřít a poškodit ESD diody. Návrh proto počítá
se **sériovým rezistorem 1 kΩ v CTRL** (při VDD = 0 omezí proud z 3,3 V na ≤ (3,3 − 0,6) V / 1 kΩ ≈ 2,7 mA,
tedy pod limit 3 mA u HMC349A). Spolu s 100 pF tvoří RC 100 ns, což je zanedbatelné proti t1/t2.
Pozice R1/R2 (0 Ω) má i EVAL HMC8038.

### DC blok, blokování, footprint
- Všechny RF piny jsou DC vázané, **na RFC, RF1 i RF2 je nutný DC blok**. Oba datasheety to
  u každého RF pinu píší jako požadavek („A dc blocking capacitor is required on this pin“), ne jako
  doporučení. Interní DC úroveň RF pinů datasheety neuvádí, proto je třeba počítat s tím, že port
  může mít DC napětí. Bez bloku by se do spínače dostalo DC zvenku, typicky z DC zkratované antény
  (smyčka, patch se zkratem, helix), z výstupu PA s tlumivkou nebo ze vstupu LNA či filtru.
  To může posunout pracovní bod a ovlivnit přepínání. Cena jsou 3 kondenzátory s |Xc| ≈ 0,7 Ω
  na 2,3 GHz, tedy zanedbatelný útlum. **Nechávám je.** Ověření na osazené desce: změřit DC napětí
  na RF pinu bez kondenzátoru. Na EVAL obou čipů jsou
  100 pF 0402. VDD: 100 pF + 0,1 µF 0402. CTRL a EN: 100 pF 0402 (HMC8038 EVAL C5, C6).
- Land pattern: datasheety ho nedávají, jen rozměry pouzdra CP-16-40 (tělo 4,00, rozteč 0,65,
  šířka vývodu 0,27–0,39, délka 0,50–0,70, EP 2,25–2,55 □). Footprint vezmu z LCSC knihovny
  EasyEDA a ověřím proti těmto mezím (krok 2).
- **Thermal vias pod EP** (z Gerberů EVAL 600-01267-00, NC-DRILL): **9 prokovů Ø 0,254 mm
  (10 mil) v mřížce 3×3 s roztečí 0,71 mm**. θJC HMC8038W je simulováno na JEDEC 2S2P
  s devíti thermal vias. Kolem RF vedení je 274 prokovů Ø 0,36 mm (14 mil) jako fence.
- Deska EVAL: HMC8038 je na Rogers 4350 nebo Arlon 25FR (skladbu datasheet neuvádí).
  HMC349A: 4 vrstvy, horní dielektrikum 10 mil RO4350, zbytek FR-4, celkem 62 mil,
  **CPWG 13 mil šířka / 10 mil mezera = 50 Ω**. Vnitřní a spodní vrstva jsou zem.
  Pro JLC FR-4 to přepočítám v kroku 3.

### Doporučené zapojení podle EVAL (vzor)
```
+5V ──┬── VDD(1)        C 100 pF + 100 nF k pinu 1
CTRL_TX ── R 1k ──┬── CTRL(2)    C 100 pF na GND, pull-down na CTRL_TX
                  └── (LED/indikace přes buffer, krok 1)
GND ──── EN(5)          C 100 pF (EVAL), EN natvrdo na zem
ANT SMA ── 100 pF ── RFC(3)
TX  SMA ── 100 pF ── RF1(9)
RX  SMA ── [ochrana RX, volit.] ── 100 pF ── RF2(12)
NC/NIC, GND, EP → GND, 3×3 vias pod EP
```

### Otevřené body k potvrzení
1. Osadit **HMC8038**, HMC349ALP4CE jen jako pinově kompatibilní náhradu (≤ 1 W)? Souhlas?
2. ~~Přiřazení~~ Potvrzeno: porty **ANT/TX/RX** (TX = RF1, RX = RF2, výchozí RX), **EN = GND natvrdo**.
3. DC bloky jsou podle datasheetu povinné (viz výše), hodnota 100 pF podle EVAL. Na 2,3 GHz je |Xc| ≈ 0,7 Ω. Konkrétní typ (C0G, SRF)
   ověřím na LCSC v kroku 2.
4. Sériový 1 kΩ v CTRL jako ochrana při výpadku 5 V (odchylka od EVAL, kde je 0 Ω).

## 1. Zapojení a rozhraní k C3

Netlist s tabulkou součástek a sítí: [`netlist.md`](netlist.md).

### Koncepce
Deska má jediné napájení **+5 V** z lišty J4. Na desce není 3,3 V ani LDO.

- **U1 HMC8038 na 5 V.** EN natvrdo na GND, ANT = RFC, TX = RF1, RX = RF2.
  DC bloky 100 pF na všech RF portech. VDD blokován 100 pF + 100 nF.
- **CTRL_TX z C3 jde přes R1 1 kΩ na pin VCTL (uzel CTRL_SW, 100 pF jako na EVAL).**
  Úroveň 3,3 V stačí (VIH 1,55 V při VDD 5 V). Převodník úrovně se nepoužije.
- **Hradlo U2 = 74AHCT1G08 napájené z +5 V:** PA_EN = CTRL_TX AND PA_REQ.
  Původní varianta byla 74LVC1G08 na 3,3 V. Zdroj: TI SN74AHCT1G08, SCLS315S (2/2024),
  https://www.ti.com/lit/ds/symlink/sn74ahct1g08.pdf
  - TTL vstupy mají při VCC 4,5–5,5 V VIH = 2,0 V a VIL = 0,8 V. Datasheet výslovně uvádí
    „Up voltage translation from 3.3 V to 5 V is allowed“.
  - Výstup má rovnou 5 V pro klíčování PA, takže není potřeba LDO ani převodník.
  - Vstupní proud je ±1 µA i při VCC = 0 V a VI = 5,5 V. Když 5 V chybí a C3 drží signály
    v 1, vstupy to snesou.
  - 74LVC1G08 na 5 V by nefungoval: VIH = 0,7·VCC = 3,5 V (TI SCES217AA).
- **Vstup A hradla bere CTRL_TX přímo z lišty, ne z uzlu CTRL_SW za RC.**
  AHCT vyžaduje hrany ≤ 20 ns/V. RC 1 kΩ × ~150 pF dává ~45 ns/V.
- **Pull-downy 4,7 kΩ na CTRL_TX a PA_REQ.** ESP32-C3 má interní pull-up 45 kΩ
  (datasheet v2.4, RPU). Kdyby ho firmware omylem zapnul, vstup vyjde na
  3,3·4,7/49,7 = 0,31 V, bezpečně pod VIL 0,8 V. Se 100 kΩ by to bylo 2,3 V, tedy logická 1.
  Zátěž GPIO v 1 je 0,7 mA. PA_EN má pull-down 10 kΩ.
- **Klíčování PA na samostatném konektoru J5, obě polarity (podle typu PA zapojit jen jednu):**
  - **PA_EN:** push-pull 5 V z U2, aktivní v 1 („+“), výstupní proud max 8 mA.
    Nepřipojovat na vstup s pull-upem nad 5 V (proud přes ochrannou diodu výstupu do +5V).
  - **PA_KEY_N:** otevřený drain Q3 (N-MOSFET, gate = PA_EN) na GND, aktivní v 0 („GND“).
    Pull-up dodává PA, napětí do VDS max Q3 (≥ 50 V, ověří krok 2).
  - Bez signálu, bez +5V i při odpojeném C3: PA_EN = 0 (R4) a Q3 je rozepnutý. PA neklíčuje.
- **PA_EN_RB:** dělič 12k/22k z PA_EN dává 3,24 V pro zpětné čtení v C3.
  GPIO C3 nejsou 5V tolerantní.
- **Spínač napájení PA na desce není** (rozhodnutí: PA má vlastní klíčovací vstup,
  napájení 5–28 V zůstává mimo desku).
- **LED TX/RX ukazují skutečný stav spínače.** Jsou buzené z CTRL_SW (pin VCTL) přes Q1/Q2,
  napájené z +5 V přes 1 kΩ. TX svítí přes Q1, RX svítí přes R6 a v TX ji Q2 zkratuje.
  Q1–Q3 jsou stejný typ, tedy jedna položka v BOM.
- **Ochrana RX (volitelná, DNP):** D1 jako shunt na straně SMA za DC blokem C3. Na straně
  spínače by dioda viděla neznámou DC úroveň RF pinu. Pokud RX řetězec napájí LNA po koaxu
  (bias-tee), D1 neosazovat.
- Úniky do RX v TX: izolace RFC→RF2 je min. 50 dB (2–4 GHz). Při 2 W (33 dBm) tak na RX
  portu bude ≤ −17 dBm. To je třeba porovnat s abs. max vstupem LNA nebo S3 (zatím
  neznámý). Pokud je LNA citlivější, osadit D1.
- Testovací body: CTRL_TX, CTRL_SW, PA_REQ, PA_EN, PA_EN_RB, PA_KEY_N, +5V, GND.
  Bod 3,3 V ze zadání odpadá, protože na desce žádné 3,3 V není.

### Rozbor stavů pojistky
CTRL_SW sleduje CTRL_TX (přes R1). PA_EN = CTRL_TX · PA_REQ, pokud má U2 napájení, jinak 0.
PA_KEY_N je sepnutý právě tehdy, když PA_EN = 1.

| situace | GPIO C3 | CTRL_SW → spínač | PA_EN | výsledek |
|---|---|---|---|---|
| C3 v resetu (EN low) | vstupy bez pull-upu* | 0 → RX | 0 | bezpečné |
| boot ROM, 2nd-stage bootloader | vstupy (GPIO3, 10, 4 bez pull-upu, GPIO10 má 5 ns low glitch) | 0 → RX | 0 | bezpečné |
| flashování (download mode, USB-JTAG) | vstupy | 0 → RX | 0 | bezpečné |
| aplikace před inicializací pinů | vstupy | 0 → RX | 0 | bezpečné |
| odpojený kabel J4 | – | 0 → RX (R2) | 0 (bez +5V, R4), Q3 rozepnutý | bezpečné |
| C3 bez napájení | piny přes ESD diody na 0 V | 0 → RX | 0 | bezpečné |
| výpadek +5V, C3 drží CTRL_TX = 1 | 1 | spínač bez VDD, proud do VCTL ≤ 2,7 mA (R1) | 0 (U2 bez VCC, vstupy ±1 µA, R4), Q3 rozepnutý | PA neklíčuje; spínač nedefinovaný, ale bez RF |
| PA_REQ = 1 bez CTRL_TX | 0 / 1 | 0 → RX | **0** | **pojistka blokuje PA** |
| CTRL_TX = 1, PA_REQ = 0 | 1 / 0 | 1 → TX | 0 | TX cesta bez PA |
| CTRL_TX = 1, PA_REQ = 1 | 1 / 1 | 1 → TX | 1 | vysílání |
| přerušená GND v kabelu | – | nedefinováno | nedefinováno | J4 má proto 2× GND, kabel krátký |

\* Podle ESP32-C3 datasheetu v2.4, tab. 2-1: GPIO3 má při resetu i po něm jen IE. GPIO4 (MTMS)
a GPIO10 mají po resetu IE bez pull-upu. GPIO10 má při náběhu napájení low glitch 5 ns
(tab. 2-2), což je bezpečný směr.

### Co pojistka NEOHLÍDÁ (musí zajistit firmware)
1. **Pořadí TX→RX.** Když CTRL_TX spadne dřív, než zmizí RF, spínač přepne pod výkonem.
   Hot switching HMC8038 je max 27 dBm, PA dává 30–33 dBm. Hradlo sice zároveň shodí PA_EN,
   ale doběh RF z PA a budicí signál z C3 tím zastavené nejsou.
2. **Pořadí RX→TX.** Je-li PA_REQ = 1 a RF běží ještě před CTRL_TX = 1, hradlo pustí PA_EN
   ve stejném okamžiku, kdy spínač teprve přepíná (≤ 0,5 µs). Opět jde o hot switching.
3. **Délku vysílání a teplotu PA nebo spínače** (zaseknutý firmware v TX).
4. **PSV antény, přebuzení PA nad 34 dBm** a přetížení RX portu nad úroveň úniku.
5. **Chybné zapojení klíčování PA:** špatná polarita (PA_EN místo PA_KEY_N nebo naopak), PA
   s vlastním trvalým povolením nebo PA_EN zapojený na vstup s pull-upem > 5 V.
   Výpadek +5V desky při napájeném PA: PA_EN je 0 a Q3 rozepnutý, takže typ „+“ i „GND“
   neklíčuje, pokud PA bez signálu sám neklíčuje.
6. **Reset C3 uprostřed vysílání.** Piny přejdou do vstupu a spínač okamžitě přepne na RX.
   Budicí RF z C3 ale reset zastaví ve stejném okamžiku a PA bez buzení nedává výkon, takže
   riziko je malé. Ověří se měřením v kroku 4.

### Rozhraní pro firmware (XIAO ESP32C3 / C3 SuperMini)
| signál | GPIO | XIAO pin | proč |
|---|---|---|---|
| CTRL_TX (výstup) | **GPIO3** | D1 | po resetu i během něj jen IE, bez pull-upu, bez glitchů |
| PA_REQ (výstup) | **GPIO10** | D10 | po resetu IE bez pull-upu, glitch jen 5 ns do 0 |
| PA_EN_RB zpětné čtení (vstup, doporučeno) | **GPIO4** | D2 | po resetu IE bez pull-upu; dělič na desce dává 3,24 V |

Zakázané piny:
- GPIO2, 8, 9 jsou strapping. GPIO9 je tlačítko BOOT, na SuperMini je na GPIO8 LED.
- GPIO18/19 jsou USB, GPIO18 má při náběhu high glitch 50 µs.
- GPIO20/21 jsou UART0, TX vypisuje boot log, RX má WPU.
- GPIO6 (MTCK) má ve výchozím stavu eFuse po resetu pull-up (IE & WPU).

Zdroje: [ESP32-C3 datasheet v2.4](https://www.espressif.com/sites/default/files/documentation/esp32-c3_datasheet_en.pdf),
[Seeed XIAO ESP32C3 pinout](https://wiki.seeedstudio.com/XIAO_ESP32C3_Getting_Started/),
SuperMini (neoficiální popis, ověřit na konkrétním kusu):
[randomnerdtutorials](https://randomnerdtutorials.com/getting-started-esp32-c3-super-mini/).
GPIO3, 4 a 10 jsou vyvedené na obou deskách.

**Časy:**
- Spínač: tON/tOFF 150 ns, ustálení RF 170 ns, RC v CTRL ≤ 0,2 µs, celkem < 0,5 µs.
- **t1 (CTRL_TX → PA_REQ) = 100 µs.** To je rezerva > 100× a pro QSK je to zanedbatelné.
- **t_pa (PA_REQ → start RF):** podle náběhu PA po klíčování, předběžně 1 ms. Změřit.
- **t2 (PA_REQ = 0 → CTRL_TX = 0) = 1 ms** předběžně. Musí pokrýt zpoždění skutečného
  zastavení RF v C3 (DMA/buffer periferie) a doběh PA. Změřit v kroku 4: detektor na ANT
  proti CTRL_SW a zkrátit, až když RF v okamžiku přepnutí leží s rezervou pod 27 dBm.

**Pseudokód:**
```c
// Úplně první věc v app_main / setup(): piny do 0 dřív, než cokoli jiného.
void tr_init(void) {
    gpio_set_level(PA_REQ, 0);  gpio_set_level(CTRL_TX, 0);   // level před direction
    gpio_set_direction(PA_REQ, OUTPUT); gpio_set_direction(CTRL_TX, OUTPUT);
    gpio_set_direction(PA_EN_RB, INPUT);                       // bez interního pull-upu!
    state = RX;
    if (gpio_get_level(PA_EN_RB) != 0) fault(ERR_PA_EN_STUCK);
    esp_register_shutdown_handler(tr_safe_off);                // esp_restart() → nejdřív PA off
}

void tr_tx_on(void) {
    if (state != RX) return;
    gpio_set_level(CTRL_TX, 1);
    delay_us(T1_US);                                           // 100 µs
    if (gpio_get_level(PA_EN_RB) != 0) { tr_safe_off(); fault(ERR_INTERLOCK); return; }
    gpio_set_level(PA_REQ, 1);
    delay_us(T_PA_US);                                         // náběh PA
    if (gpio_get_level(PA_EN_RB) != 1) { tr_safe_off(); fault(ERR_PA_EN_LOW); return; }
    rf_start();
    tx_deadline = now() + TX_TIMEOUT;                          // hlídání zaseknutí v TX
    state = TX;
}

void tr_tx_off(void) {           // a totéž jako tr_safe_off() při chybě
    rf_stop();                   // zastavit RF z C3 a počkat, až periferie opravdu skončí
    gpio_set_level(PA_REQ, 0);
    delay_us(T2_US);             // 1 ms: doběh RF + PA
    if (gpio_get_level(PA_EN_RB) != 0) fault(ERR_PA_EN_STUCK);  // hlásit, ale pokračovat
    gpio_set_level(CTRL_TX, 0);
    state = RX;
}

// Periodicky (task / timer): if (state == TX && now() > tx_deadline) tr_tx_off(), fault(ERR_TX_TIMEOUT).
// Chyba / restart: VŽDY tr_safe_off() před esp_restart(). Panic/WDT reset to nestihne,
// tam platí hardware (reset zastaví RF i piny, viz rozbor bod 6).
```

## 2. BOM ověřený na LCSC a JLCPCB

Stav k **21. 10. 2026**. Každá položka je načtená ze stránky `lcsc.com/product-detail/<LCSC>.html`
(výrobce, MPN, pouzdro, sklad LCSC, cena) a `jlcpcb.com/partdetail/<LCSC>` (Basic/Extended,
sklad JLC pro osazení). Ceny jsou v USD za kus při nejmenším odběrním množství LCSC.
Import pro JLC/EasyEDA: [`bom.csv`](bom.csv) (Comment, Designator, Footprint, LCSC Part #).

| ref | LCSC | výrobce | MPN | pouzdro | JLC | sklad LCSC | sklad JLC | cena LCSC |
|---|---|---|---|---|---|---|---|---|
| U1 | C208270 | ADI | HMC8038LP4CETR | LFCSP-16 4×4 | Extended | 21 | 252 | 8,71 (1 ks) |
| U2 | C113521 | TI | SN74AHCT1G08DBVR | SOT-23-5 | Extended | 17 345 | 21 287 | 0,090 (5+) |
| J1–J3 | C5199907 | Samtec | SMA-J-P-H-ST-EM1 | edge-mount | Extended | 588 | 468 | 5,45 (1 ks) |
| J4 | C492405 | XFCN | PZ254V-11-06P | 1×6 2,54 THT | Extended | 67 420 | 69 645 | 0,043 (20+) |
| J5 | C2937625 | XFCN | PZ254V-11-03P | 1×3 2,54 THT | Extended | 754 200 | 884 470 | 0,020 (50+) |
| C1–C4, C6 | C1546 | FH | 0402CG101J500NT, 100 pF C0G 50 V | 0402 | **Basic** | 1 202 400 | 3 440 548 | 0,0034 (100+) |
| C5, C10 | C1525 | Samsung | CL05B104KO5NNNC, 100 nF X7R 16 V | 0402 | **Basic** | 8 570 500 | 38 046 045 | 0,0038 (100+) |
| C7 | C15850 | Samsung | CL21A106KAYNNNE, 10 µF X5R 25 V | 0805 | **Basic** | 2 885 080 | 9 545 656 | – |
| R1, R5, R6 | C11702 | UNI-ROYAL | 0402WGF1001TCE, 1 kΩ 1 % | 0402 | **Basic** | 8 371 000 | 20 161 641 | – |
| R2, R3 | C25900 | UNI-ROYAL | 0402WGF4701TCE, 4,7 kΩ 1 % | 0402 | **Basic** | 8 167 400 | 14 972 758 | – |
| R4 | C25744 | UNI-ROYAL | 0402WGF1002TCE, 10 kΩ 1 % | 0402 | **Basic** | **0** | 18 639 261 | 0,0013 (100+) |
| R9 | C25752 | UNI-ROYAL | 0402WGF1202TCE, 12 kΩ 1 % | 0402 | **Basic** | 450 400 | 917 858 | – |
| R10 | C25768 | UNI-ROYAL | 0402WGF2202TCE, 22 kΩ 1 % | 0402 | **Basic** | 744 200 | 1 375 946 | – |
| Q1–Q3 | C8545 | JSCJ | 2N7002 | SOT-23 | **Basic** | 1 851 700 | 2 457 710 | 0,016 (50+) |
| LED1 | C2286 | KENTO | KT-0603R, červená | 0603 | **Basic** | 5 762 700 | 8 234 470 | 0,0077 (100+) |
| LED2 | C12624 | KENTO | KT-0603G, zelená | 0603 | Extended | 471 450 | 472 767 | 0,012 (50+) |
| D1 (DNP) | C5380972 | Infineon | BAT1504WH6327XTSA1 (BAT15-04W) | SOT-323 | Extended | 2 881 | 2 913 | 0,46 (1 ks) |

Ceny „–“ jsem nevypisoval, jde o setiny centu. Plné ceny jsou v uložených stránkách LCSC.

Náhrady a poznámky:
- **R4 10 kΩ (C25744): na LCSC 0 ks, na JLC 18,6 mil.** Pro osazení u JLC je to v pořádku.
  Pro nákup na LCSC lze použít **C60490 YAGEO RC0402FR-0710KL** (179 500 ks, 0,0024 USD).
- **U1 HMC8038: LCSC jen 21 ks, JLC 252 ks**, na pár testovacích desek to stačí.
  Pinově kompatibilní záloha (≤ 1 W) je **C207982 HMC349ALP4CE** (LCSC 56 ks, 9,20 USD).
  HMC349ALP4CETR C128836 má 0 ks.
- **Q1–Q3 2N7002 (JSCJ) místo BSS138**, protože 2N7002 je Basic (BSS138 C52895/C82045 jsou
  Extended). Datasheet JSCJ: V(BR)DSS 60 V, VGS(th) 1–2,5 V, RDS(on) ≤ 7 Ω při VGS 5 V.
  - Q3 (PA_KEY_N) má gate z PA_EN = 5 V, takže je ve specifikované oblasti.
  - Q1/Q2 (LED) mají gate z CTRL_SW ≈ 3,3 V. Při nejhorším VGS(th) 2,5 V zbývá 0,8 V
    přebuzení, na 2–5 mA pro LED to stačí, ale RDS(on) při 3,3 V datasheet neuvádí.
    Kdyby LED RX v TX nezhasínala, osadit BSS138LT1G C82045 (VGS(th) 0,5–1,5 V,
    onsemi Rev. 8), footprint je stejný.
- **D1 BAT15-04W** (Infineon v1.0, 2018-06-30): sériový pár RF Schottky, VR 4 V, IF 110 mA,
  C ≈ 0,3 pF, VF 0,25–0,41 V při 10 mA. **Pin 3 (společný) na RF_RX, piny 1 a 2 na GND**
  tvoří antiparalelní omezovač. Je to jednoduchá ochrana proti úniku a statice, ne
  výkonový limiter. Skutečný PIN limiter SMP1330-005LF (C150870) má na LCSC 0 ks.
  D1 není v `bom.csv` (DNP).
- **DC bloky 100 pF FH 0402 C0G** podle EVAL ADI, která s 100 pF měří až do 6 GHz.
  **Rezonanční kmitočet (SRF) ani ESL datasheet FH neuvádí**, takže nevím, zda je 100 pF
  na 2,3 GHz pod rezonancí nebo nad ní. Ověřit měřením vložného útlumu v kroku 4.
  Případně porovnat s menší hodnotou (blíž sériové rezonanci).
- **Montáž:** J1–J3 (edge-mount přes hranu desky) a J4/J5 (THT) počítat s ručním pájením,
  nebo je v JLC objednávce vybrat jako THT/ruční. Ostatní je SMT jednostranně.
- **Počet Extended typů: 6** (U1, U2, J1–J3, J4, J5, LED2). Zelenou LED lze nahradit druhou
  červenou C2286 (Basic) a ušetřit jeden Extended poplatek.

### SMA edge-mount: tloušťka desky a launch
- **Samtec SMA-J-P-H-ST-EM1**, výkres SMA-J-P-X-ST-EM1 Rev. G
  (https://suddendocs.samtec.com/prints/sma-j-p-x-st-em1-mkt.pdf): **„Recommended PCB layout,
  board thickness: 1.57 mm“**, 50 Ω, do 18 GHz (stránka produktu Samtec).
  Sedí na standardní JLC 1,6 mm (4 vrstvy JLC04161H).
- Doporučený footprint z výkresu (na TOP i BOTTOM):
  - středový signálový pad je **1,27 mm široký**;
  - dva zemní pady mají vnitřní mezeru **4,30 mm** a vnější rozteč **7,00 mm**
    (šířka tedy (7,00 − 4,30)/2 = 1,35 mm);
  - délkové kóty 4,20 / 0,50 / 0,10 mm od hrany desky: podle obrázku jsou zemní pady
    o 0,50 mm delší než středový a pady jsou 0,10 mm od hrany. Ověřit proti výkresu při
    kreslení footprintu.
- **Launch:** středový pad 1,27 mm je výrazně širší než 50Ω vedení. Na 4vrstvé desce
  s tenkým dielektrikem to dělá kapacitní nespojitost. Pod padem proto vyříznout zem v L2
  (případně i L3), aby se pad blížil 50 Ω, a pak plynule zúžit na šířku GCPW.
  Rozměry cut-outu spočítám v kroku 3 a ověřit se dají měřením (TG, krok 4).
- Pro srovnání: **Amphenol 132134 (C3174425) je přímý THT konektor, ne edge-mount**
  (výkres Amphenol, 4 nožičky na rastru 5,08 mm).

## 3. Skladba desky, 50Ω vedení a rozmístění

Výpočet: [`../calc/calc_gcpw.py`](../calc/calc_gcpw.py), výstup [`../calc/gcpw_out.txt`](../calc/gcpw_out.txt).

### Metoda
- **2D řešič pole metodou konečných diferencí** (jen numpy). Počítá skutečnou tloušťku mědi
  35 µm a vrstvené dielektrikum. Z0 a eeff vycházejí z kapacity s dielektrikem a ve vzduchu.
- **Kontrola proti mikropásku (Hammerstad):** odchylka 1–2 % (53,0 proti 52,3 Ω, resp.
  49,6 proti 50,0 Ω).
- **Konvergence:** mřížka má krok S/12 a W se mění po celých krocích mřížky s lineární
  interpolací. Zjemnění na S/24 změní W o 0,004 mm (~1 %).
- **Konformní vzorec pro GCPW** (Wadell 3.4.3) dává pro tyto geometrie 55–59 Ω. Protože mezera S
  je srovnatelná s výškou h, vychází vysoko. Je uveden jen pro srovnání.
- **Bez masky.** Nepájivá maska sníží Z0 asi o 1–2 Ω. Finální kontrolu udělat v JLC
  impedanční kalkulačce. Kdyby vyšlo pod 48 Ω, zúžit W na ~0,30 mm.

### 50Ω GCPW (měď 35 µm, bez masky, FD)
| skladba | h L1–L2 mm | er | S 0,15 → W | S 0,20 → W | S 0,25 → W | eeff (S 0,20) |
|---|---|---|---|---|---|---|
| **JLC04161H-7628** | 0,2104 | 4,40 | 0,284 | **0,316** | 0,321 | 2,92 |
| JLC04161H-2116 | 0,1164 | 4,16 | 0,175 | 0,187 | 0,187 | 2,87 |
| JLC04161H-3313 | 0,0994 | 4,10 | 0,153 | 0,161 | 0,158 | 2,84 |
| 2 vrstvy 1,6 mm | 1,53 | 4,50 | 0,743 | 0,931 | 1,091 | 2,67 |

Od S ≈ h dál už W skoro neroste, protože vedení určuje hlavně zem v L2.
Drobné nemonotónnosti (0,187/0,187, 0,161/0,158) jsou v mezích přesnosti řešiče (~1 %).

### Volba: **JLC04161H-7628, W = 0,316 mm, S = 0,20 mm**
- **Celková tloušťka 1,6 mm** sedí na doporučenou desku 1,57 mm pro SMA EM1 (kap. 2).
- **Šířka ~0,32 mm odpovídá padům HMC8038.** Vývod LFCSP je široký 0,27–0,39 mm s roztečí
  0,65 mm, takže vedení vstupuje do pinu bez skoku šířky.
  - 2116 a 3313 vychází na 0,16–0,19 mm, užší než pad. Výrobní tolerance leptání
    (±0,02–0,03 mm) by tam dělala relativně větší chybu Z0.
- **2 vrstvy nevyhovují:** 0,93 mm je víc než rozteč vývodů 0,65 mm. U pinu by vznikl velký
  skok šířky a pole by sahalo daleko do okolí.
- **Mezera 0,20 mm** má rezervu proti minimu JLC (0,09 mm, resp. 0,10 mm).
  - S 0,15 mm by vedení zúžilo na 0,284 mm a impedance by byla citlivější na podleptání mezery.
  - S 0,25 mm už W nepřidá (0,321 mm).

**Přiřazení vrstev:**
| vrstva | použití |
|---|---|
| L1 (TOP) | RF vedení, všechny součástky, zemní polygon kolem GCPW |
| L2 | **souvislá GND**, bez řezů kromě výřezu pod SMA (launch) |
| L3 | **souvislá GND** (reference pro launch SMA, viz níže) |
| L4 (BOTTOM) | logika a +5V, zbytek GND polygon |

RF vedení nesmí křížit nic na L2 ani na L4 pod sebou.

### Via fence a sešití zemí
- λ/20 je na 2345 MHz v FR-4 asi **3,0 mm**, takže rozteč fence musí být pod touto mezí.
- **Volím rozteč ≤ 1,5 mm (λ/40)**, prokovy vrták 0,3 mm / pad 0,5–0,6 mm (JLC 4 vrstvy).
  - Prokovy po obou stranách GCPW, střed asi 0,5 mm od okraje mezery, takže měď prokovu
    nezasahuje do mezery S.
  - EVAL ADI má fence ještě hustší (274 prokovů Ø 0,36 mm), na kratších vedeních to není potřeba.
- Zbytek zemního polygonu sešít mřížkou prokovů ≤ 3 mm a prokovy po obvodu desky.
- **Délka vedení:** λg = 74,8 mm, čtvrtvlna je 18,7 mm. RF vedení držet krátká (≤ 10–12 mm)
  kvůli útlumu FR-4 a menšímu vlivu odchylky Z0.
- **DC bloky 0402 na vedení:** pad 0402 (~0,5 mm) je o něco širší než W. Nespojitost je asi
  0,5 mm dlouhá, tedy ~2,4° elektrické délky, a na 2,3 GHz ji lze zanedbat. Výřez pod padem
  kondenzátoru nedělám.

### HMC8038: pady a EP
- **Footprint** z knihovny LCSC/EasyEDA ověřit proti CP-16-40: rozteč 0,65, šířka padu ≤ 0,39,
  EP 2,25–2,55 □.
- **Thermal vias pod EP podle Gerberů EVAL 600-01267-00:** 3×3, vrták 0,25 mm (10 mil),
  rozteč 0,71 mm, všechny na L2/L3/L4 GND.
  - **Ověřit při objednávce:** prokovy v padu bez zaplnění odsávají pájku. Buď objednat
    zaplnění (epoxy filled & capped / via-in-pad) u JLC, nebo rozdělit pastu na EP do 4 oken
    mimo prokovy.
- **Piny NC (4, 6–8, 13–16), GND (10, 11) a EN (5)** spojit krátce na zemní měď kolem pouzdra
  a ze zemních plošek vést prokovy hned u pinu.
  - Vedle RFC (pin 3) jsou pin 2 VCTL a pin 4 NC→GND. GCPW tak má u čipu z jedné strany
    zem a z druhé blokovaný signál (C6 100 pF), což je přijatelné.

### Launch SMA EM1
| reference pod středovým padem 1,27 mm | top zem na padech (S 1,515) | Z0 |
|---|---|---|
| L2 (bez výřezu) | ano | **21 Ω** (silně kapacitní) |
| L3 (výřez v L2) | ano | 66 Ω |
| L3 (výřez v L2) | **top zem 0,31 mm od padu** | **50 Ω** |

- **Výřez v L2 pod celým středovým padem**, šířka ≥ pad + 2 × (0,31 + 0,6) ≈ **3,1 mm** (rezerva
  na šíření pole do strany). Délka = délka padu. **L3 pod výřezem musí být plná zem.**
- **Na TOP** vylít zem až 0,31 mm od středového padu a spojit ji se zemními pady konektoru.
  Prokovy kolem výřezu (L1–L2–L3–L4) s roztečí ≤ 1 mm, aby se zem obou referencí potkala
  krátce u hrany.
- **Přechod** ze středového padu 1,27/S 0,31 nad L3 na vedení 0,316/S 0,20 nad L2:
  - lineární zúžení dlouhé ~1 mm na konci padu;
  - výřez v L2 končí tam, kde začíná zúžení.
- **Model je 2D** a nepočítá s pláštěm konektoru ani se zemními pady na BOTTOM. Výsledek ověřit
  měřením v kroku 4 (TDR nebo S11 VNA). Případné doladění: rozšířit nebo zúžit výřez, ne vedení.

### Rozmístění (náčrt)
```
                 J3 RX (horní hrana)
                       ║
                       ║  C3 (+ D1 DNP u konektoru)
   ┌───────────────────╫───────────────────────────┐
   │          13-16 NC ║                           │
   │        ┌──────────╨─┐                         │
   │  C4 C5 ┤1        12 │      U2   Q1 Q2 Q3      │ J4 1×6  (k C3)
   │  R1 C6 ┤2    U1     │      R2–R10, C7, C10   │  +5V GND CTRL_TX
J1 ═══ C1 ══┤3    EP     │      LED1 TX LED2 RX   │  PA_REQ PA_EN_RB GND
ANT│   GND ─┤4         9 │      TP1–TP8           │
   │        └──5-8─────╥─┘                        │
   │          EN→GND   ║                           │ J5 1×3  (k PA)
   │                   ║  C2                       │  PA_EN PA_KEY_N GND
   └───────────────────╫───────────────────────────┘
                       ║
                 J2 TX (dolní hrana)
```
- **U1 blízko levé hrany**, RFC (pin 3) míří přímo na ANT. RF1 (pin 9) a RF2 (pin 12) jsou na
  pravé straně pouzdra a vedení se k TX dolů a k RX nahoru stáčí jedním obloukem nebo dvěma
  zkosenými lomy 45°.
- **Pořadí na vedení:** pin → DC blok co nejblíž pinu → GCPW → launch.
  - D1 (DNP) je u konektoru RX.
  - C4 100 pF přímo u pinu 1, C5 100 nF za ním. C6 u pinu 2, R1 za ním.
- **Logika (U2, Q1–Q3, děliče, LED) vpravo u lišt**, daleko od RF. Spoje vést po L1/L4
  mimo oblast GCPW a launchů.
- **Lišty J4/J5 na pravé hraně** (ruční pájení). LED viditelné z TOP. 4× M2,5 v rozích mimo
  launch a fence.
- **Rozměr desky** odhadem 35 × 30 mm. Upřesní se při kreslení podle footprintů SMA,
  zemní pady EM1 jsou 7 mm široké.

### Realizace v EasyEDA (21. 10. 2026)
Projekt **TR-SWITCH-13CM** v EasyEDA Pro (zdrojový projekt a skripty tu nejsou).

Odchylky od návrhu výše:
- **GCPW W 0,321 / S 0,254 mm místo 0,316 / 0,20.** Pravidlo desky pro odstup pour je 0,254 mm.
  Podle tabulky FD dává S 0,25 → W 0,321 mm, eeff 2,95, tedy stejných 50 Ω, a pravidla není třeba měnit.
- **Launch SMA podle výpočtu:**
  - náběh 1,27 → 0,321 mm na 1 mm (fill);
  - na TOP zakázaná oblast pour 0,31 mm kolem středového padu a náběhu;
  - v Inner1 (L2) výřez 3,1 mm pod středovým padem, referencí je tam L3.
- **Řada prokovů podél RF:**
  - prokovy 0,3 / 0,61 mm, střed asi 0,8 mm od osy vedení, rozteč 0,9–1,2 mm (62 ks);
  - v řadě kolem RX vedení je mezi C3 a D1 (y 16,9–18,9 mm) mezera asi 3 mm (≈ λ/20). Tudy vedou +5V a CTRL_SW po BOTTOM k U1.
- **Prokovy pod EP:** 3×3, vrták 0,30 mm místo 0,254 (minimum pravidel EasyEDA/JLC), rozteč 0,71 mm.
  **Při objednávce zvolit zaplnění prokovů (via-in-pad, epoxy filled & capped)**, jinak hrozí odsávání pájky z EP.
- **C5 (100 nF)** je nad U1 na cestě +5V (asi 3 mm od pinu 1). Roh u pinů 1/2 byl jinak neprůchodný.
  U pinu VDD zůstává C4 100 pF, u VCTL C6 100 pF.
- **Spoj +5V má 0,25 mm.** Proud je jen pár mA (U1 0,16 mA, hradlo, LED ≤ 5 mA), signály mají 0,2 mm.
- **GND pinů U1:** 10, 11, 15 a 16 jsou krátkým spojem napojené přímo na EP (mezi piny se nevejde prokov ani pour).
  C4.2 je napojený na U1.16.
- **Testovací body nejsou** (měří se na J4/J5 a na padu C6), otvory H1–H4 jen v PCB.
- **Deska** 33 × 26 mm, rohy R 0,5, 4 vrstvy JLC04161H-7628, GND pour na všech vrstvách, všechny součástky na TOP.
- **Chyba v objednané verzi: zemní pady SMA mají thermal relief** (zjištěno po objednání, 22. 10. 2026).
  - Pravidlo pour `connectMode 0` platí i pro J1–J3. Na TOP i BOTTOM jsou 3 spojky 0,254 mm a mezera 0,254 mm pod maskou.
    Dvě spojky jsou příčně asi 2,2 mm od hrany, třetí je na vnitřním konci padu. V padu není prokov, nejbližší je za jeho koncem.
  - Zem koplanárního vedení u středového padu je plný pour s prokovy do L3/L4, ta je v pořádku. Slabý je jen přechod
    plášť → zem desky: zpětný proud jde po padu asi 2 mm od hrany ke spojce.
  - Odhad na 2,33 GHz: slot 0,25 × 2 mm má asi 8–10° a dává v zemi sériovou reaktanci několika Ω.
    Příspěvek k S11 je asi −25 až −35 dB, izolace se může zhoršit o jednotky dB. Ověřit měřením v 4.4.
  - Stejné spojky měly i oba GND pady omezovače D1 (zkrat na zem přímo na RX vedení).

### Verze 2 (22. 10. 2026): zemní pady RF dílů bez thermal relief
- **Oprava:** přes každý GND pad J1–J3 (TOP i BOTTOM) a D1 (TOP) je zamčená výplň (fill) GND. Má rozměr padu + 16 mil
  na každou stranu, takže přemostí mezeru 10 mil a o 6 mil přesahuje do pour. Od obrysu desky drží 14 mil (DRC chce ≥ 11,8 mil).
  Plán a nezávislá kontrola odstupů (≥ 10 mil od cizí mědi, díry, zákazy pour): `sma_gnd.py <dump> out/route/sma_gnd.json`.
  Celkem 14 výplní.
- Prokov za koncem každého zemního padu SMA už ve v1 byl (x 4,78 mm u J1, obdobně u J2/J3), další se nepřidávaly.
- Ostatní GND pady zůstávají s thermal relief (ruční pájení lišt, malé SMD mimo RF).
- Potisk „HMC8038 v2“. Součástky, BOM a CPL se nemění.
- **DRC** (`out/route/drc_v2c.json`): stejné 2 vědomé výjimky jako ve v1 (15× pad SMA k okraji, Netlist Error).
  V Gerberech v2 je na všech zemních padech SMA a D1 plná měď.
- Výrobní data: [`vyroba/`](../vyroba/). Objednávka beze změny oproti v1 (stackup, zaplnění prokovů v EP, DNP).

**DRC** (`out/route/drc_final.json`): 0 chyb mimo dvě vědomé výjimky.
- 15× „pad k okraji desky“ u SMA: pady jsou 0,10 mm od hrany podle výkresu Samtec, je to edge-mount.
- „Netlist Error“ (PCB vs. schéma): všech 94 pinů i atributy dílů jsou ověřené shodně. Stejné hlášení EasyEDA V3 zůstalo i u USB HUB 2P.

**Ověření v impedanční kalkulačce JLCPCB** (jlcpcb.com/pcb-impedance-calculator, 21. 10. 2026):
- zadání: 4 vrstvy, 1,6 mm, 1 oz / 0,5 oz, Coplanar Single Ended, L1 nad L2, 50 Ω, mezera k zemi 10 mil;
- **JLC04161H-7628 (Standard, 1,59 mm ±10 %, prepreg 7628 0,2104 mm): W = 12,61 mil = 0,320 mm.**
  Na desce je 0,321 mm, šířku tedy není třeba měnit.
- V objednávce vybrat přesně skladbu JLC04161H-7628 bez písmene. Varianty 7628A–G, 3313A, 2116… jsou „Special“ s jiným dielektrikem.

## 4. Plán měření osazené desky

Pořadí je od bezpečných kroků k výkonovým: kontrola bez napájení, DC a logika, malý signál na VNA, přepínací časy, výkon. Na RF porty se výkon PA nepouští, dokud neprojdou kroky 4.1–4.4. Výsledky se zapisují do tabulky v 4.9.

### Přístroje
| přístroj | k čemu | náhrada |
|---|---|---|
| zdroj 5 V s omezením proudu (nastavit 30 mA) | napájení J4 | USB 5 V přes multimetr v sérii |
| zdroj nebo dělič 3,3 V, 2 přepínače / C3 s testovacím FW | CTRL_TX, PA_REQ | XIAO C3 s jednoduchým FW (sériové příkazy) |
| multimetr | DC, proudy | – |
| osciloskop ≥ 100 MHz, 2–4 kanály | logika, časy | – |
| **VNA do ≥ 3 GHz** (např. LiteVNA 64), kalibrační sada SOLT SMA | S11/S21, izolace, TDR | spektrální analyzátor s tracking generátorem |
| **3× zakončení 50 Ω SMA** (dvě do 0,5 W, jedno výkonové) | nezapojené porty | – |
| RF detektor (log, např. AD8318 / AD8317 modul) nebo diodový detektor | časování RF obálky | spektrák v zero-span |
| spektrální analyzátor (Rigol) + **útlumové články 30–40 dB, ≥ 5 W** | únik do RX, výkon, harmonické | – |
| zdroj signálu 2,3 GHz (C3 + driver, nebo generátor) a PA 1–2 W | výkonové testy | – |
| teploměr (termočlánek / IR) | ohřev U1 | prst ne |

Pravidla: zemnicí náramek (HMC8038 HBM 4 kV, náhrada HMC349A jen 250 V). Výkonové testy jen do zátěže 50 Ω, analyzátor vždy za útlumovým článkem. Nezapojený RF port spínače vždy zakončit 50 Ω.

### 4.0 Bez napájení
1. Vizuálně: U1 (pin 1, můstky mezi piny 0,65 mm), U2, orientace LED1/LED2, Q1–Q3. EP U1 nejde vidět. Jeho připojení se ověří v 4.3 přes útlum a izolaci.
2. Odpor **+5V–GND** (J4.1–J4.2): > 1 kΩ (C7 se nabíjí, údaj roste). Zkrat = můstek nebo C.
3. DC propojení na RF: J1, J2, J3 středový kolík → GND musí být rozpojené (DC bloky C1–C3). Plášť SMA ↔ GND propojený.
4. J4.3 → GND ≈ 4,7 kΩ (R2), J4.4 → GND ≈ 4,7 kΩ (R3), J4.5 → GND ≈ 22 kΩ ‖ (12 kΩ + 10 kΩ) ≈ 11 kΩ.

### 4.1 DC a logika (bez RF, porty zakončené 50 Ω)
Napájení J4: +5V a GND, CTRL_TX a PA_REQ z 3,3 V přes přepínač (nebo z C3). Na J5.2 (PA_KEY_N) dát pull-up 10 kΩ na +12 V (simulace vstupu PA).

| CTRL_TX | PA_REQ | CTRL_SW | PA_EN (J5.1) | PA_KEY_N (J5.2) | PA_EN_RB (J4.5) | LED | proud +5V (očekávaně) |
|---|---|---|---|---|---|---|---|
| plovoucí (J4 bez signálů) | plovoucí | 0 V | 0 V | 12 V (rozepnuto) | 0 V | RX | ≈ 2,1 mA |
| 0 | 0 | 0 V | 0 V | 12 V | 0 V | RX | ≈ 2,1 mA |
| 0 | 1 | 0 V | **0 V** (pojistka) | 12 V | 0 V | RX | ≈ 2,1 mA |
| 1 | 0 | 3,3 V | 0 V | 12 V | 0 V | TX | ≈ 8,2 mA |
| 1 | 1 | 3,3 V | **≈ 5 V** | **< 0,2 V** | **≈ 3,2 V** | TX | ≈ 8,9 mA |

Očekávané proudy: U1 0,16 mA, LED RX ~1,9 mA, LED TX ~3 mA. V TX zkratuje Q2 uzel LED RX (R6 5 mA). PA_EN zatěžuje R4 a dělič R9/R10 (~0,65 mA).
Proud z C3 do vstupů je 0,7 mA na každý signál v 1 (R2, R3).

Doplňkové kontroly:
- **Interní pull-up C3:** mezi CTRL_TX a 3,3 V připojit 47 kΩ (náhrada 45 kΩ RPU). CTRL_TX má zůstat ≈ 0,3 V, spínač v RX, PA_EN 0.
- **Výpadek +5V při CTRL_TX = PA_REQ = 1:** odpojit jen +5V. Proud z 3,3 V do CTRL_TX musí být ≤ 3,4 mA (0,7 mA R2 + ≤ 2,7 mA přes R1). PA_EN = 0 V, PA_KEY_N rozepnuto.
- **Q1/Q2 při 3,3 V na gate** (2N7002, VGS(th) až 2,5 V): LED RX musí v TX zhasnout. Pokud jen pohasne, osadit BSS138LT1G (C82045), footprint je stejný (kap. 2).
- **DC na RF pinech:** měřit na padu C1.2 / C2.1 / C3.1 (strana U1) proti GND v RX i v TX. Očekává se ~0 V. Pokud je tam DC, DC bloky jsou opravdu nutné (kap. 0), jinak je to informace pro budoucí verzi.

### 4.2 Kalibrace VNA
- Rozsah **2,0–2,7 GHz, 401 bodů, IF BW ≤ 1 kHz**, výkon VNA výchozí (~−10 dBm).
- SOLT na koncích kabelů (referenční rovina = konektory kabelů). Útlum SMA konektorů desky zůstává v měření, a to je správně.
- Kontrola kalibrace: thru kabel–kabel S21 = 0 ± 0,05 dB, open/short na Smithově diagramu v bodě.
- Pro přehled zvlášť široké pásmo **0,1–6 GHz** (vliv 100 pF DC bloků, rezonance, nežádoucí jevy).

### 4.3 Malý signál: útlum, přizpůsobení, izolace
Měřit v obou stavech. Třetí port vždy zakončit 50 Ω. Odečítat na **2320, 2340 a 2345 MHz**.

| stav | měření | připojení VNA | očekávání (datasheet + deska) | mez |
|---|---|---|---|---|
| RX (CTRL_TX 0) | vložný útlum ANT→RX | P1 J1, P2 J3 | 0,8 dB typ. + ~0,2 dB (SMA, C, vedení) | ≤ 1,5 dB |
| RX | přizpůsobení ANT, RX | S11, S22 | – | ≥ 15 dB útlum odrazu |
| RX | izolace ANT→TX | P1 J1, P2 J2 | ≥ 50 dB (datasheet min.) | ≥ 45 dB |
| TX (CTRL_TX 1) | vložný útlum TX→ANT | P1 J2, P2 J1 | jako výše | ≤ 1,5 dB |
| TX | přizpůsobení TX, ANT | S11, S22 | – | ≥ 15 dB |
| TX | izolace ANT→RX | P1 J1, P2 J3 | ≥ 50 dB | ≥ 45 dB |
| TX | izolace TX→RX | P1 J2, P2 J3 | – | ≥ 45 dB (určuje únik do RX v 4.6) |
| RX | zakončení TX portu (terminated path) | S11 na J2 | spínač zakončuje 50 Ω | ≥ 12 dB |

Vyhodnocení:
- **Útlum vyšší, než se čeká, ale přizpůsobení dobré:** podezřelé jsou ztráty v kondenzátorech nebo špatně připájený EP. EP spojuje GND piny 10/11 a zem pod čipem, takže to sníží i izolaci.
- **Izolace pod 45 dB:** EP nebo GND piny nejsou dobře připájené, případně vázání přes vedení. Porovnat RX a TX stav.
- **Útlum odrazu pod 15 dB:** přejít na TDR (4.4) a najít místo nespojitosti.
- **Široké pásmo:** pokud sériový obvod 100 pF + ESL kondenzátoru vytváří kolem 2,3 GHz znatelnou indukčnost (útlum odrazu se zhoršuje s kmitočtem), zkusit C1–C3 s menší hodnotou. Cílem je sériová rezonance blíž 2,33 GHz, orientačně 10–22 pF C0G 0402 (záleží na ESL). Pak měření zopakovat.

### 4.4 TDR (časová oblast VNA)
- Režim lowpass step, rozsah 0–1 ns za referenční rovinou, okno normal.
- Na každém portu a v obou stavech odečíst impedanci:
  1. pad SMA + výřez v L2: návrh 50 Ω, výpočet bez pláště konektoru;
  2. náběh;
  3. vedení GCPW: 50 Ω;
  4. pad C a pin U1.
- **Mez ±5 Ω na launchi, ±3 Ω na vedení.** Rozlišení VNA do 3–6 GHz je jen kolem 100 ps (~1 cm na FR-4), takže jednotlivé prvky splynou. Hodnotí se hlavně, zda je launch kapacitní (Z < 45 Ω) nebo induktivní (Z > 55 Ω).
- **Thermal relief na zemních padech SMA (kap. 3, Realizace):** na jednom portu (J1) změřit S11 a TDR před úpravou a po ní.
  1. Měření na desce tak, jak přišla.
  2. Úprava: na TOP i BOTTOM seškrábnout masku v mezeře podél vnitřní hrany zemního padu (strana ke středovému padu) a u hrany desky,
     mezeru zalít cínem. Případně přes ni připájet pásek Cu fólie.
  3. Měření znovu a také izolace z 4.3. Pokud se S11 nebo izolace zlepší znatelně (≥ 3 dB), upravit i J2 a J3 a na dalších kusech.
- **Oprava pro další verzi:** při kapacitním launchi zvětšit výřez v L2 nebo odstup TOP země. Při induktivním je zmenšit. Šířku vedení neměnit (kap. 3).

### 4.5 Časování přepínání
**a) Logika (osciloskop, bez RF):** CTRL_TX (J4.3) proti CTRL_SW (pad C6) a PA_EN (J5.1).
- CTRL_SW: RC 1 kΩ × ~150 pF, náběh 10–90 % asi 0,3 µs.
- PA_EN za PA_REQ: < 50 ns.
- PA_EN se nesmí objevit, když CTRL_TX = 0. Spouštět na PA_REQ při CTRL_TX = 0 a hledat zákmity.

**b) RF obálka:**
- **Zapojení:** do TX (v RX stavu do RX) pustit CW 2,34 GHz, asi 0 dBm. Na ANT detektor, třetí port zakončit.
- **Buzení:** CTRL_TX přepínat obdélníkem 1 kHz.
- **Měřit** zpoždění od hrany CTRL_TX do 90 % (zapnutí) a do 10 % (vypnutí) RF na ANT.
- **Očekávání:** tON/tOFF 150 ns plus RC v CTRL, celkem **< 0,5 µs**. Hodnota t1 = 100 µs má tedy rezervu > 100×.

**c) Sekvence firmwaru s C3 a PA do zátěže:**
- **Zapojení:** detektor na ANT přes útlumový článek. Kanály: CTRL_SW, PA_REQ, PA_EN, výstup detektoru.
- **Kalibrace detektoru:** předem zjistit napětí detektoru pro **27 dBm** na ANT. To je hranice hot switching HMC8038.
- **Měření t_pa:** od PA_REQ ↑ do ustálení RF (±0,5 dB). Podle toho nastavit T_PA_US.
- **Měření t2:** od PA_REQ ↓ (a rf_stop()) do poklesu RF pod úroveň 27 dBm. **Nastavit T2_US ≥ 2× změřená hodnota.** V okamžiku hrany CTRL_SW ↓ musí být RF aspoň 10 dB pod 27 dBm.
- **Kontrola:** stejné měření i pro vypínání v nejhorším případě (nejdelší buffer RF periferie C3).

### 4.6 Výkonové zkoušky (TX cesta)
Zapojení: PA → J2 (TX), J1 (ANT) → výkonový útlumový článek 30–40 dB → měřič nebo spektrák, J3 (RX) → 20 dB článek → spektrák.
1. Výkon zvyšovat po krocích 20 → 27 → 30 → 33 dBm (2 W). Na každém kroku změřit útlum TX→ANT (proti měření PA přímo do článku):
   změna oproti 20 dBm ≤ 0,1 dB až do 33 dBm (P0.1dB HMC8038 při 5 V je 35 dBm).
2. **Únik do RX** při 33 dBm: změřený výkon na J3 musí odpovídat izolaci z 4.3. Očekává se ≤ −17 dBm.
   Porovnat s abs. max vstupem LNA nebo S3. Pokud je limit nižší než únik + 6 dB rezerva, **osadit D1** (BAT15-04W, C5380972) a zopakovat 4.3 (útlum RX) i tento bod. D1 nesmí zhoršit útlum ANT→RX o více než ~0,2 dB.
3. **Teplota U1** po 5 min nepřetržitě při 33 dBm (dummy load na ANT): pouzdro < 70 °C při 25 °C okolí (rezerva k 85 °C, při kterém datasheet garantuje 34 dBm).
4. Volitelně harmonické na ANT při 33 dBm (2. a 3. harmonická 4,7 / 7,0 GHz): pro informaci, filtrování řeší PA.
5. **Nikdy** nepřepínat CTRL_TX při zapnutém PA (hot switching 27 dBm). Tento test se nedělá.

### 4.7 Pojistka a chybové stavy (PA do zátěže, RF z C3 vypnuté nebo nízké)
| scénář | jak vyvolat | očekávání |
|---|---|---|
| PA_REQ bez CTRL_TX | FW nebo přepínač | PA_EN 0, PA_KEY_N rozepnuto, PA neklíčuje |
| reset C3 během TX | tlačítko RST nebo `esp_restart()` | CTRL_TX i PA_REQ → 0 do < 1 ms, RF z C3 zastaveno. Změřit pořadí na osciloskopu (kap. 1, bod 6) |
| odpojení kabelu J4 během TX | vytáhnout konektor | PA_EN 0 (R4), spínač RX (R2), PA neklíčuje |
| výpadek +5V desky, C3 drží 1 | vypnout jen +5V | PA_EN 0, PA_KEY_N rozepnuto, proud do CTRL_TX ≤ 3,4 mA |
| zaseknutý FW v TX | FW bez rf_stop (test build) | TX_TIMEOUT ve FW vypne PA_REQ, pak CTRL_TX |
| PA_EN_RB proti stavu | FW čte GPIO4 v každém kroku | chyba ERR_INTERLOCK / ERR_PA_EN_STUCK se nevyhlásí v normálním provozu |

### 4.8 Kritéria pro „deska OK“ a návaznost
- Všechny body 4.1 podle tabulky, 4.3 v mezích, 4.5 b) < 0,5 µs, 4.6 bez komprese a ohřevu, 4.7 bez selhání.
- Nastavit ve FW změřené **T_PA_US a T2_US** (4.5 c) a rozhodnout o **D1** (4.6).
- Do verze 2 převzít: případnou změnu hodnoty DC bloků (4.3), úpravu výřezu nebo odstupu u SMA (4.4), Q1/Q2 → BSS138 (4.1).
- Přímé napojení zemních padů J1–J3 a D1 na pour je už ve v2 (kap. 3, Verze 2). Případné další změny z měření patří do v3.

### 4.9 Záznam výsledků
| bod | 2320 MHz | 2340 MHz | 2345 MHz | pozn. |
|---|---|---|---|---|
| RX: útlum ANT→RX [dB] | | | | |
| RX: S11 ANT / S22 RX [dB] | | | | |
| RX: izolace ANT→TX [dB] | | | | |
| TX: útlum TX→ANT [dB] | | | | |
| TX: S11 TX / S22 ANT [dB] | | | | |
| TX: izolace ANT→RX, TX→RX [dB] | | | | |
| TDR launch J1 / J2 / J3 [Ω] | | | | |
| J1 před / po přemostění thermal relief: S11 [dB], izolace [dB] | | | | |
| přepínání ON / OFF [µs] | | | | |
| t_pa, t2 změřené → nastavené [µs] | | | | |
| útlum TX→ANT při 20/27/30/33 dBm [dB] | | | | |
| únik do RX při 33 dBm [dBm] | | | | |
| teplota U1 po 5 min při 33 dBm [°C] | | | | |
