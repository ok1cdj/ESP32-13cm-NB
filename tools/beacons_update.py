#!/usr/bin/env python3
"""beacons_update.py: compare web/beacons.json (the 13 cm beacon list of the page) with the reception reports of DL0TUD.

DL0TUD's interactive VHF-microwave beacon list (DJ5CW, https://dl0tud.tu-dresden.de/beacons/) is crowdsourced: one CSV line
per reception report. Its 13 cm beacon segment (2320.8-2321.0 MHz) is grouped by callsign here; the latest report gives the
frequency, locator and date, a remark with "QRT" or "off air" marks the beacon off. The list in web/beacons.json is ours and
edited by hand (entries from other sources, e.g. the CRK list for OK, keep their values); this prints what DL0TUD says
differently or in addition, --add appends the beacons it does not have yet.
    tools/beacons_update.py [--add]
"""
import argparse
import csv
import io
import json
import os
import re
import urllib.request

URL = "https://dl0tud.tu-dresden.de/beacons/csv.php"
LIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "beacons.json")
SEGMENT = (2320.8, 2321.0)   # MHz, IARU Region 1 13 cm beacons
OFF_RE = re.compile(r"\bQRT\b|off air", re.I)


def dl0tud():
    """{call: entry} from the reports in the beacon segment, the latest report of each call winning."""
    text = urllib.request.urlopen(URL, timeout=30).read().decode("utf-8", "replace")
    out = {}
    for r in csv.DictReader(io.StringIO(text), delimiter=";"):
        try:
            mhz = float(r["QRG"])
        except ValueError:
            continue
        if not SEGMENT[0] <= mhz <= SEGMENT[1]:
            continue
        call = r["CALL"].strip().upper()
        e = {"call": call, "mhz": mhz, "loc": r["LOC"].strip().upper(), "last": r["DATE"].strip(),
             "status": "qrt" if OFF_RE.search(r["REM"]) else "qrv", "src": "DL0TUD"}
        if call not in out or e["last"] >= out[call]["last"]:
            out[call] = e
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--add", action="store_true", help="append the beacons web/beacons.json does not have")
    a = ap.parse_args()
    with open(LIST, encoding="utf-8") as f:
        doc = json.load(f)
    ours = {b["call"]: b for b in doc["beacons"]}
    theirs = dl0tud()
    new = []
    for call, t in sorted(theirs.items(), key=lambda kv: kv[1]["mhz"]):
        o = ours.get(call)
        if not o:
            new.append(t)
            print(f"new   {call:10} {t['mhz']:.3f} {t['loc']:8} {t['status']} {t['last']}")
            continue
        diff = [f"{k} {o.get(k)} -> {t[k]}" for k in ("mhz", "loc", "status") if o.get(k) != t[k]]
        if diff and t["last"] > o.get("last", ""):
            print(f"diff  {call:10} " + ", ".join(diff) + f" (DL0TUD {t['last']}, ours {o.get('src')} {o.get('last', '-')})")
    if a.add and new:
        doc["beacons"] += new
        doc["beacons"].sort(key=lambda b: b["mhz"])
        with open(LIST, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print(f"{len(new)} added to {os.path.normpath(LIST)}")


if __name__ == "__main__":
    main()
