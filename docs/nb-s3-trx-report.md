# Jedna ESP32-S3 jako TX i RX na 13 cm – průzkum (NB krok 1, bod 5)

9. 11. 2026 · jen průzkum, nic neimplementováno · zdroje: `esp32-sdr-trx` (0BSD, submodul ESP32-DATV-RX v ESP32-ATV),
jeho `docs/transmitter.md`, `docs/research/TX-RESEARCH.md` (Stage 6), `docs/research/PLAN-IQ-TX.md`; eSpDR issue #3.

## Shrnutí

- **S3 vysílat umí – a už existuje funkční kód.** `espdr-tx` (esp32-sdr-trx) vysílá FM, SSB a RTTY polární modulací
  přes testovací tón PHY. Pro CW (i OOK48) to stačí: klíčovaná nosná bez AM-PM.
- **I/Q přehrávací engine na S3 existuje a byl reprodukován** (stejný registr jako na C3), ale **bez smyčky** a s bankou
  16384 slov – ne držený registr jako na C3. Držený-registr trik na S3 nikdo nezkoušel.
- **Hlavní překážka není vysílání, ale přepínání:** dnes jsou RX a TX dva různé firmwary nahrávané do RAM (~8 s).
  Half-duplex potřebuje jeden firmware s oběma cestami a sdílením paměti capture bank.
- **Doporučení:** pro CW/OOK48 pokračovat **dvoudeskově (C3 TX + S3 RX)** – funguje dnes, společné TCXO dává koherentní
  TX/RX. Jednodeskovou S3 sledovat jako experiment: (1) CW přes polární TX `espdr-tx` + stejné TCXO, (2) pokus o držený
  I/Q registr, (3) teprve pak jeden firmware RX+TX.

## Co S3 umí vysílat

| Cesta | Stav | Vlastnosti |
|---|---|---|
| Testovací tón PHY + PLL sigma-delta (polární, `espdr-tx`) | hotové, 1 deska otestovaná | kmitočet 457,8 Hz kroky, ~40 k změn/s; amplituda 0,28 dB/krok, rozsah 18 dB; SSB: nežádoucí postranní 61–63 dB, IM3 33 dB; 2320–2450 MHz; „pár µW“ s PCB anténou; tepelná kompenzace z čidla čipu |
| I/Q playback engine `0x60033D64`, banka 2 `0x3FCD0000` | reprodukováno (větev `research/iq-tx`) | 10bit I/Q jako C3, 40/80 MS/s, max 16384 slov = 204,8 µs, **bez smyčky**: re-trigger z CPU, šev 128–240 ns; nutné po zaklíčování vynulovat bit 18 `0x60006040`; zrcadlo 33 dB (62 dB s předkorekcí) |
| Držený registr (1 slovo, hold bit 19 + run, CPU přepisuje) – trik z C3 | **nevyzkoušeno** | bity 13:0 počet−1, 15 rychlost, 18 hotovo, 19 hold, 31 run – na C3 firmware používá `0x80000|1` + run; na S3 by šlo stejně, ale hold bit „blokuje start“ – ověřit |

Rizika: banka 3 překrývá data ROM (`rom_phyFuns`) – zápis tam čip shodil; fázový šum PLL omezuje koherentní modulace
(EVM ~28 % na 179 µs), pro CW/FSK/OOK nevadí; rozpor zdrojů (lozaning/ESP32SDR tvrdí, že replay na S3 nevyzařuje –
vyvráceno chybějícím krokem s bitem 18).

## Half-duplex na jednom čipu

- **Firmware:** dnes `espdr-rx` a `espdr-tx` nahrávají do RAM každý svůj image (přepnutí ~8 s). Jeden image musí mít
  obě cesty; RX capture používá banky 0–2 jako ring, I/Q TX by chtěl banku 2 → přesunout ring do bank 0–1 (PLAN-IQ-TX,
  Phase C). Polární TX žádnou banku nepotřebuje → nejjednodušší kombinace RX + polární TX.
- **Doba přepnutí** RX↔TX v jednom firmwaru: nezměřena nikde. Odhad: přeladění PLL + kalibrace PHY jednotky ms
  (na C3 každý start TX znovu kalibruje PHY – posune únik LO o desetiny kódu). Pro CW/OOK48 (QSK ne) stačí desítky ms.
- **RF cesta:** jeden RF pin → dva spínače (u čipu malý SPDT, u antény HMC8038), vypínání LNA při TX, sekvencování PA
  (viz `nb-cw-ssb-13cm.md`, kap. 9). Dvoudesková sestava potřebuje jen spínač u antény.

## Poznatky z dnešního měření, které se týkají jednočipové varianty

- **Vypnutý vysílač dál vyzařuje svůj LO** (C3 po `CW OFF`: −78,6 dBm na konektoru, ale silně přes desku, S3 ho
  přeslechem vidí). U jednočipové S3 bude LO při RX stejně na kmitočtu příjmu – to je normální stav přijímače.
- **S3 jako přijímač** má vlastní artefakty se silným signálem (zrcadlo ~−28 dB, produkty ±10,4 kHz) a ztrácí data
  při 333 ksps přes vytížený USB hub – při jednočipovém TRX bude USB nést i TX data (polární TX je ale málo dat).
- **Společné TCXO** pro TX i RX (dnešní sestava) dává koherenci, kterou jednočipová varianta má zadarmo.

## Navržené kroky (pokud pokračovat)

Návrh vlastního firmwaru RX + TX: [`nb-s3-trx-fw-navrh.md`](nb-s3-trx-fw-navrh.md).

1. `espdr-tx` na S3 s TCXO: CW/FSK nosná na 2320 MHz, změřit na tinySA (úroveň, spektrum, fázový šum vůči C3).
2. Pokus o držený I/Q registr na S3 (malý testovací firmware, podle C3 sekvence + bit 18 `0x60006040`).
3. Jeden firmware RX + polární TX, změřit dobu přepnutí.
4. Teprve pak RF deska se dvěma spínači.

Licence: esp32-sdr-trx je 0BSD → lze převzít i do GPL; I/Q trik C3 je z PolyForm forku – na S3 implementovat nezávisle.
