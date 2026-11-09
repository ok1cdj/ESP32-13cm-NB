"""Our bench (imported by the tools); override with the environment variables TX_PORT, RX_PORT, SA_PORT, RX_VENV.

All boards here run from one 40 MHz TCXO board (C3 and S3 at XTAL_P, its test tap J3 at the tinySA): the C3 and the S3 share their
reference, so the frequency difference between them is only the PLL rounding; absolute frequency needs an outside reference.
"""
import os

TX_PORT = os.environ.get("TX_PORT", "/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_7C:4F:AD:D1:B4:0C-if00")  # XIAO C3, TCXO
RX_PORT = os.environ.get("RX_PORT", "/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_A0:F2:62:EA:C5:70-if00")  # XIAO S3, TCXO
SA_PORT = os.environ.get("SA_PORT", "/dev/serial/by-id/usb-tinysa.org_tinySA4_400-if00")                                   # tinySA Ultra+ ZS-407
# Python of ESP32-DATV-RX (espdr, the S3 receiver tools)
RX_VENV = os.environ.get("RX_VENV", os.path.expanduser("~/projekty/ESP32-ATV/third_party/ESP32-DATV-RX/.venv/bin/python"))
