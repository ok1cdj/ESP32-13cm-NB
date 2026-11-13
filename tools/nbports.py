"""Our bench (imported by the tools); override with the environment variables TX_PORT, RX_PORT, SA_PORT, RX_VENV.

All boards here run from one 40 MHz TCXO board (C3 and S3 at XTAL_P, its test tap J3 at the tinySA): the C3 and the S3 share their
reference, so the frequency difference between them is only the PLL rounding; absolute frequency needs an outside reference.
"""
import os

TX_PORT = os.environ.get("TX_PORT", "/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_7C:4F:AD:D1:B4:0C-if00")  # ESP32-C3 SuperMini Plus, TCXO
RX_PORT = os.environ.get("RX_PORT", "/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_A0:F2:62:EA:C5:70-if00")  # Waveshare ESP32-S3-Zero, TCXO
SA_PORT = os.environ.get("SA_PORT", "/dev/serial/by-id/usb-tinysa.org_tinySA4_400-if00")                                   # tinySA Ultra+ ZS-407
# Python of ESP32-DATV-RX (espdr, the S3 receiver tools)
RX_VENV = os.environ.get("RX_VENV", os.path.expanduser("~/projekty/ESP32-ATV/third_party/ESP32-DATV-RX/.venv/bin/python"))


def tty_release(ser):
    """Close a pyserial port leaving VMIN = 1, VTIME = 0 on the tty.

    pyserial sets VMIN = VTIME = 0 and the tty keeps them after the close; Chrome's Web Serial on Linux takes the settings as it
    finds them, its first read() then returns 0 bytes and it reports "The device has been lost". esptool and idf.py monitor do
    the same; after them: stty -F /dev/ttyACMn min 1 time 0
    """
    import termios
    try:
        attrs = termios.tcgetattr(ser.fd)
        attrs[6][termios.VMIN], attrs[6][termios.VTIME] = 1, 0
        termios.tcsetattr(ser.fd, termios.TCSANOW, attrs)
    except (termios.error, OSError, TypeError, AttributeError):
        pass                                                   # not a tty, or already closed
    ser.close()

