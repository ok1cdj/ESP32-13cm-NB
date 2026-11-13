#!/bin/sh
# Copies the firmware images into web/fw/ for the page's flasher (ESP Web Tools manifests), with their licences.
#   C3 (TX): the build of tools/build_c3_cw.sh (fw/ESP32-DATV-SA, branch cw-beacon, PolyForm Noncommercial)
#   S3 (RX): the ESP-SDR release zip (zodoczi/esp-sdr, GPL-3.0-or-later), by default build/esp-sdr/fw.zip
#   tools/fw_bundle.sh [S3_ZIP]
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
C3B="$ROOT/build/c3-cw/src/build"
S3Z=${1:-$ROOT/build/esp-sdr/fw.zip}
OUT="$ROOT/web/fw"
[ -f "$C3B/esp32_datv.bin" ] || { echo "no C3 build in $C3B: tools/build_c3_cw.sh -"; exit 1; }
[ -f "$S3Z" ] || { echo "no S3 release zip $S3Z"; exit 1; }

# manifest NAME VERSION CHIP_FAMILY APP_FILE
manifest() {
    cat <<EOF
{
  "name": "$1",
  "version": "$2",
  "new_install_prompt_erase": true,
  "builds": [
    {
      "chipFamily": "$3",
      "parts": [
        { "path": "bootloader.bin", "offset": 0 },
        { "path": "partition-table.bin", "offset": 32768 },
        { "path": "$4", "offset": 65536 }
      ]
    }
  ]
}
EOF
}

rm -rf "$OUT/c3" "$OUT/s3"
mkdir -p "$OUT/c3" "$OUT/s3"

C3V=$(cat "$ROOT/build/c3-cw/src/version.txt")
case "$C3V" in *dirty*) echo "C3 build $C3V is not a commit: commit and rebuild first"; exit 1;; esac
cp "$C3B/bootloader/bootloader.bin" "$C3B/partition_table/partition-table.bin" "$C3B/esp32_datv.bin" "$OUT/c3/"
cp "$ROOT/fw/ESP32-DATV-SA/LICENSE" "$OUT/c3/LICENSE"
manifest "NB 13 cm TX: ESP32-C3 CW/SSB (ESP32-DATV-SA cw-beacon)" "$C3V" ESP32-C3 esp32_datv.bin > "$OUT/c3/manifest.json"
cat > "$OUT/c3/README.md" <<EOF
ESP32-C3 transmitter firmware: ESP32-DATV-SA by SP8ESA, fork https://github.com/ok1cdj/ESP32-DATV-SA branch \`cw-beacon\`,
commit \`$C3V\`, built by \`tools/build_c3_cw.sh\` (board config XIAO C3, no built-in DVB-S2 beacon).
Licence: PolyForm Noncommercial 1.0.0 (\`LICENSE\`), non-commercial use only.
EOF

T=$(mktemp -d)
unzip -q "$S3Z" -d "$T"
S3V=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['revision'][:7])" "$T/version.json")
cp "$T/bootloader/bootloader.bin" "$T/partition_table/partition-table.bin" "$T/esp_sdr.bin" "$T/version.json" "$OUT/s3/"
rm -rf "$T"
manifest "NB 13 cm RX: ESP32-S3 ESP-SDR (IQS)" "$S3V" ESP32-S3 esp_sdr.bin > "$OUT/s3/manifest.json"
cat > "$OUT/s3/README.md" <<EOF
ESP32-S3 receiver firmware: ESP-SDR, https://github.com/zodoczi/esp-sdr (fork of ESPARGOS/esp-sdr), revision \`$S3V\`
(release zip as published, \`version.json\`). Licence: GPL-3.0-or-later; the source is at the revision above.
EOF
ls -l "$OUT/c3" "$OUT/s3"
