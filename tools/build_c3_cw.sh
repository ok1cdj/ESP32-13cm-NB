#!/bin/sh
# Builds the C3 transmitter firmware from fw/ESP32-DATV-SA (local clone of the ESP32-DATV-SA fork, PolyForm Noncommercial,
# kept out of this repository by .gitignore) for the ESP32-C3 (board config XIAO C3; runs on the C3 SuperMini Plus too) and optionally flashes it.
# Without the built-in DVB-S2 test card: after power-up the C3 transmits nothing until it gets a command.
#   . ~/esp/esp-idf-v6.1/export.sh
#   tools/build_c3_cw.sh [PORT|-]        (- or no PORT: build only)
#   SDKCONFIG_EXTRA="CONFIG_A=y" tools/build_c3_cw.sh ...   (extra sdkconfig lines)
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${1:--}
SRC="$ROOT/fw/ESP32-DATV-SA/firmware"
[ -d "$SRC" ] || { echo "no $SRC: git clone --branch xiao-panel <ESP32-DATV-SA> fw/ESP32-DATV-SA"; exit 1; }
command -v idf.py >/dev/null || { echo "idf.py not found: . ~/esp/esp-idf-v6.1/export.sh"; exit 1; }
FW="$ROOT/build/c3-cw"
mkdir -p "$FW"
rsync -a --delete --exclude build --exclude sdkconfig --exclude sdkconfig.old "$SRC/" "$FW/src/"
{
    echo "CONFIG_DATV_BOARD_XIAO_C3=y"          # front panel OLED on D2/D0 (GPIO4/2)
    echo "# CONFIG_DATV_BUILTIN_BEACON is not set"
    [ -z "$SDKCONFIG_EXTRA" ] || printf '%s\n' $SDKCONFIG_EXTRA
} >> "$FW/src/sdkconfig.defaults"
git -C "$SRC" describe --always --dirty > "$FW/src/version.txt"   # INFO shows the firmware's version, not this repository's
cd "$FW/src"
# a new sdkconfig whenever sdkconfig.defaults changed: an existing sdkconfig keeps its old values otherwise
cmp -s sdkconfig.defaults ../sdkconfig.defaults.last || { rm -f sdkconfig; cp sdkconfig.defaults ../sdkconfig.defaults.last; }
[ -f sdkconfig ] || idf.py set-target esp32c3
idf.py build
[ "$PORT" = "-" ] || idf.py -p "$PORT" flash
