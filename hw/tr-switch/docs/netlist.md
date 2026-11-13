# T/R přepínač 13 cm – netlist

Návrh: krok 1 v `report.md`. Díly ověřené na LCSC/JLCPCB: krok 2 v `report.md`, import: `bom.csv`.
Deska má jediné napájení **+5 V** (3,3 V se na desce nepoužívá).

## Blokové schéma
```
 J4 +5V ──┬──► U1 VDD (HMC8038, C4 100p + C5 100n)
          ├──► U2 VCC (74AHCT1G08, C10 100n)
          └──► LED (R5, R6)

 J4 CTRL_TX ──┬── R2 4k7 ⏚                         ┌── Q1 ─ LED1 TX (červená)
   (3,3 V)    ├── R1 1k ── CTRL_SW ─┬─ C6 100p ⏚    ├── Q2 ─ LED2 RX (zelená, v TX zhasne)
              │                     ├─ U1 VCTL      │
              │                     └───────────────┘
              └───────────────┐
 J4 PA_REQ ──┬── R3 4k7 ⏚     ▼  A
   (3,3 V)   └────────────► U2 74AHCT1G08 (TTL vstupy, 5 V výstup)
                            B   │ Y
                                ▼
                     PA_EN (5 V) ──┬── R4 10k ⏚
                                   ├──► J5 PA_EN    (klíčování „+“: 5 V = TX)
                                   ├── Q3 drain ──► J5 PA_KEY_N (klíčování „GND“: otevřený kolektor, sepnuto = TX)
                                   └── R9 12k ── PA_EN_RB ── R10 22k ⏚ ──► J4 PA_EN_RB (3,3 V → C3)

 J1 ANT ═══ C1 100p ═══ U1 RFC
 J2 TX  ═══ C2 100p ═══ U1 RF1        (CTRL_SW = 1)
 J3 RX  ═══ D1 limiter (volit., DNP) ═══ C3 100p ═══ U1 RF2   (CTRL_SW = 0, výchozí)
            U1 EN, NC, GND, EP → GND
```

## Součástky

Testovací body TP1–TP8 z návrhu vypadly (rozhodnutí 21. 10. 2026): měří se na lištách J4/J5 a na padu C6 (CTRL_SW).
| ref | hodnota / díl | pouzdro (předběžně) | pozn. |
|---|---|---|---|
| U1 | HMC8038LP4CE | LFCSP-16 4×4, EP | alt. HMC349ALP4CE (pinově kompatibilní, ≤ 1 W) |
| U2 | SN74AHCT1G08DBVR | SOT-23-5 | napájení 5 V, TTL vstupy; vlastní značka hradla (osobní knihovna), footprint a LCSC C113521 beze změny |
| J1, J2, J3 | Samtec SMA-J-P-H-ST-EM1 (edge-mount, deska 1,57 mm) | – | ANT, TX, RX |
| J4 | lišta 1×6, 2,54 mm | – | k C3: +5V, GND, CTRL_TX, PA_REQ, PA_EN_RB, GND |
| J5 | lišta 1×3, 2,54 mm | – | k PA: PA_EN (+5 V aktivní 1), PA_KEY_N (OD na GND, aktivní 0), GND |
| C1, C2, C3 | 100 pF C0G | 0402 | DC bloky RF |
| C4 | 100 pF C0G | 0402 | VDD U1, co nejblíž pinu 1 |
| C5 | 100 nF X7R | 0402 | VDD U1 |
| C6 | 100 pF C0G | 0402 | CTRL_SW filtr (EVAL C5) |
| C7 | 10 µF X5R, ≥ 10 V | 0805 | +5V vstup |
| C10 | 100 nF X7R | 0402 | VCC U2 |
| R1 | 1 kΩ | 0402 | sériový do CTRL (ochrana při VDD = 0) |
| R2, R3 | 4,7 kΩ | 0402 | pull-downy CTRL_TX, PA_REQ |
| R4 | 10 kΩ | 0402 | pull-down PA_EN |
| R5, R6 | 1 kΩ | 0402 | LED TX (~3 mA), LED RX (~1,9 mA) z 5 V |
| R9 | 12 kΩ | 0402 | dělič PA_EN → PA_EN_RB |
| R10 | 22 kΩ | 0402 | dělič PA_EN → PA_EN_RB |
| Q1, Q2, Q3 | 2N7002 (JSCJ), VDS 60 V | SOT-23 | LED TX, LED RX, Q3 = výstup PA_KEY_N (OD) |
| D1 | BAT15-04W (sériový pár Schottky) | SOT-323 | ochrana RX (volit., DNP): pin 3 → RF_RX, piny 1, 2 → GND |
| LED1 | červená | 0603 | TX |
| LED2 | zelená | 0603 | RX |
| H1–H4 | montážní otvor M2,5 (Ø 2,7 mm, neprokovený) | jen v PCB | 2,6 mm od rohů, bez sítě |

## Sítě
| síť | připojení |
|---|---|
| +5V | J4.1, U1.1 (VDD), C4.1, C5.1, C7.1, U2.VCC (5), C10.1, R5.1, R6.1 |
| GND | J4.2, J4.6, J5.3, U1.4–8, U1.10, U1.11, U1.13–16, U1.EP, pláště J1–J3, U2.GND (3), záporné konce C4–C7, C10, R2.2, R3.2, R4.2, R10.2, Q1.S, Q2.S, Q3.S, D1.1, D1.2, LED2.K |
| CTRL_TX | J4.3, R2.1, R1.1, U2.A (1) |
| CTRL_SW | R1.2, U1.2 (VCTL), C6.1, Q1.G, Q2.G |
| PA_REQ | J4.4, R3.1, U2.B (2) |
| PA_EN | U2.Y (4), R4.1, R9.1, J5.1, Q3.G |
| PA_EN_RB | R9.2, R10.1, J4.5 |
| PA_KEY_N | Q3.D, J5.2 |
| LED_TX_K | LED1.K, Q1.D (LED1.A ← R5.2) |
| LED_RX_A | R6.2, LED2.A, Q2.D |
| RF_ANT | J1.signál, C1.1 |
| RF_C | C1.2, U1.3 (RFC) |
| RF_TX | J2.signál, C2.1 |
| RF_1 | C2.2, U1.9 (RF1) |
| RF_RX | J3.signál, D1.3 (shunt), C3.1 |
| RF_2 | C3.2, U1.12 (RF2) |
| EN | U1.5 → GND (natvrdo) |

- **LED2 RX:** +5V → R6 → uzel LED_RX_A → LED2 → GND. Q2 v TX uzel zkratuje (5 mA přes R6).
- **LED1 TX:** +5V → R5 → LED1 → Q1 → GND.
- **Dělič PA_EN_RB:** 5 V · 22/(12 + 22) = 3,24 V, bezpečné pro GPIO C3 (nejsou 5V tolerantní).
- **Klíčování PA (J5), použít jen jeden z vývodů podle typu PA:**
  - **PA_EN:** push-pull 5 V z U2 (výstup max ±8 mA), aktivní v 1. Nepřipojovat na vstup,
    který má pull-up nad 5 V, protože by tekl proud přes ochrannou diodu výstupu do +5V.
  - **PA_KEY_N:** otevřený drain Q3 na GND, aktivní v 0 (sepnuto = TX). Pull-up dodává PA,
    dovoleno až do VDS max Q3 (≥ 50 V, ověří krok 2) a proudu ≤ desítky mA.
  - Bez signálu, bez +5V i při odpojeném C3: PA_EN = 0 (R4) a Q3 je rozepnutý
    (gate přes R4 na 0). PA tedy neklíčuje.
