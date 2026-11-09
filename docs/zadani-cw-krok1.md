# Úkol: NB krok 1 – CW maják na ESP32-C3 (TCXO), měření spektra a příjem přes ESP32-ATV

## Kontext
Projekt ESP32-ATV (https://github.com/ok1cdj/ESP32-ATV) má hotový DATV řetězec: maják na C3
(fork ok1cdj/ESP32-DATV-SA, větev esp32-atv) a příjem na XIAO ESP32-S3 Plus (fork
ok1cdj/ESP32-DATV-RX) se skripty rx/rx.sh, rx_dvbs2.py, rtl_tcp na 127.0.0.1:1234, záznam I/Q,
DC kalibrace (`BDC`, cal_dc.py). Plán úzkopásmového provozu: docs/nb-cw-ssb-13cm.md.

**Nově:** C3 má místo krystalu **TCXO 40 MHz** (clipped sine přes 10 pF na XTAL_P) –
kmitočet je stabilní, takže má smysl začít s úzkopásmovým provozem.

**Cíl tohoto kroku:** první vysílání a příjem CW signálu.
1. C3 jako **CW maják** = testovací zdroj signálu.
2. **Spektrum** na spektrálním analyzátoru ovládaném z PC (tinySA Ultra+ ZS-407, případně Rigol DSA1030).
3. **Příjem** na S3 se **stávajícími skripty ESP32-ATV** (rtl_tcp → SDR++, záznam I/Q) + analýza v Pythonu.

Do budoucna možná varianta: **jedna S3 jako TX i RX** – teď jen zjistit, co by to vyžadovalo (viz krok 5).

## Krok 0: průzkum, NEJDŘÍV REPORT
Zjisti a shrň, pak počkej na potvrzení:
- **Firmware C3 (fork ESP32-DATV-SA):** jak se nastavuje kmitočet LO a s jakým rozlišením;
  jak se zapisuje „držený“ I/Q registr DAC a jakou rychlostí ho CPU zvládne přepisovat
  (pro softwarové NCO a tvarování obálky); parser příkazů na USB; autostart majáku z NVS;
  jak se aplikuje DC korekce (`BDC`); omezení kmitočtu (2300–2450 MHz).
- **Skripty ESP32-ATV:** jak spustit S3 jen jako I/Q zdroj (rtl_tcp pro SDR++) bez DVB-S2
  dekódování; jak nahrát I/Q do souboru (formát, metadata); dostupné vzorkovací rychlosti
  (500 ksps cs4, 333 ksps cs8) a jemné ladění / offset.
- **tinySA Ultra+ ZS-407:** frekvenční rozsah (vidí 2. harmonickou 4640 MHz?), přesnost úrovně
  a kmitočtu, ovládání přes USB sériový port (příkazy pro sweep, čtení dat, marker),
  existující Python knihovny/nástroje; maximální vstupní výkon.
- **Rigol DSA1030:** ovládání přes SCPI (USB/LAN, pyvisa) jako alternativa.

## Krok 1: CW maják na C3 (fork ESP32-DATV-SA, větev esp32-atv)
- Nový režim **CW** (vedle DVB-S2 majáku), spouštěný příkazem z USB i automaticky z NVS.
- **Nosná přes softwarové NCO:** rotující fázor I/Q s nastavitelným offsetem od LO
  (např. +10 až +50 kHz, 0 povoleno) – signál mimo zbytkový únik LO + jemné ladění po Hz.
  Rychlost aktualizace DAC a tabulku sin/cos zvol podle kroku 0.
- **Tvarované klíčování:** obálka raised cosine, náběh/doběh ~5 ms (parametr).
- **Obsah majáku:** Morse text (např. `VVV DE OK1CDJ`), nastavitelné WPM (výchozí ~15),
  pak **dlouhá nosná** (např. 10 s, parametr) pro měření kmitočtu a driftu, opakovaně.
- Parametry: kmitočet, NCO offset, amplituda, WPM, text, délka nosné, délka náběhu.
  Uložení do NVS, příkaz pro výpis stavu (INFO).
- DC korekce (`BDC`) platí i v CW režimu.
- Výchozí kmitočet pro test **2320,050 MHz** (úzkopásmový segment), ale testy vedeně do útlumu.

## Krok 2: měření spektra z PC
- Skript `tools/sa_capture.py` (tinySA přes USB sériový port; Rigol přes SCPI jako volba):
  sweep, uložení do CSV + PNG, marker na špičce.
- Měření (výsledky do docs/):
  - kmitočet a úroveň nosné, **odchylka od nastavené hodnoty** (s TCXO);
  - **drift**: log kmitočtu špičky každých ~5 s po dobu 30 min od studeného startu
    (pro srovnání s krystalem, pokud mám data);
  - únik LO na kmitočtu LO vs. nosná na offsetu (vliv `BDC`);
  - **spektrum klíčování** (key clicks) – šířka a strmost při 5 ms náběhu, srovnání s 1 ms;
  - obrazy DAC a nežádoucí produkty v okolí ±10 MHz;
  - 2. harmonická, pokud tinySA dosáhne.

## Krok 3: příjem přes skripty ESP32-ATV
- S3 jako I/Q zdroj se stávajícím firmwarem a skripty; **poslech v SDR++ přes rtl_tcp**
  v režimu CW (postup a nastavení do docs/).
- **Záznam I/Q** a Python analýza `tools/cw_analyze.py`:
  - kmitočet nosné a jeho průběh v čase (drift), SNR, odchylka přijímače vs. vysílače;
  - obálka klíčování (doby značek/mezer, tvar náběhu);
  - jednoduchý **CW dekodér** (Goertzel/FFT na nalezeném tónu + adaptivní práh + časování)
    → výpis dekódovaného textu majáku jako důkaz celé cesty.
- Zapojení: C3 → koax → útlum (30–60 dB) → S3; ověřit únik vyzařováním (odpojit koax u S3,
  signál musí zmizet).

## Krok 4: dokumentace
- docs/nb-cw-krok1.md (cs): zapojení, příkazy, nastavení SDR++, výsledky měření (kmitočet,
  drift, spektrum, klíčování), snímky spektra a vodopádu.

## Krok 5: varianta jedna S3 jako TX i RX (jen průzkum, neimplementovat)
- Zjisti, zda trik s I/Q DAC (přehrávací engine / držený registr) z ESP32-DATV existuje
  nebo je přenositelný na **ESP32-S3** (RF testovací knihovna, registry) – zdroje, rizika.
- Co by znamenal half-duplex na jednom čipu: přepínání TX/RX za běhu, doba přepnutí,
  RF cesta (jeden RF pin → dva spínače kvůli PA a LNA, viz docs/nb-cw-ssb-13cm.md kap. 9).
- Výstup: krátký report s doporučením, zda pokračovat.

## Omezení
- **Flashování C3 a jakékoli vysílání: vždy se nejdřív zeptej.** Testy jen vedeně do útlumu
  nebo umělé zátěže, nízká úroveň. Max. vstupní výkon tinySA nepřekročit (útlum!).
- Úpravy firmwaru jen ve forku ESP32-DATV-SA (PolyForm Noncommercial); **nic z něj nekopíruj**
  do GPL částí ESP32-ATV. Analytické a měřicí skripty (tools/, docs/) patří do ESP32-ATV (GPL).
- Stávající DVB-S2 maják a příjem musí dál fungovat.
- Commity po logických krocích, zprávy anglicky, NEPUSHUJ.

## Hotovo, když
- C3 vysílá CW maják (text + dlouhá nosná) s NCO offsetem a tvarovaným klíčováním,
  parametry v NVS.
- Mám spektrum z tinySA/Rigolu: kmitočet, drift 30 min, únik LO, klíčování, nežádoucí produkty.
- S3 přijímá signál v SDR++ přes stávající skripty a `cw_analyze.py` z nahraného I/Q dekóduje text.
- Mám krátký report k variantě jedna S3 jako TX i RX.
