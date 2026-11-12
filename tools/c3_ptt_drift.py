#!/usr/bin/env python3
"""c3_ptt_drift.py: carrier frequency of a plain-crystal XIAO C3 (cw-beacon fw) on the tinySA: 180 s continuous, then 6 x (10 s on, 10 s off).
Port of the test C3 hard-coded; output docs/s3-trx/c3_plain_drift.csv/.png."""
import sys,time,serial;sys.path.insert(0,'tools')
import numpy as np
from sa_capture import TinySA, peak
P='/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_AC:27:6E:7F:9F:34-if00'
c=serial.Serial(P,115200,timeout=1);time.sleep(0.3);c.read(c.in_waiting or 1)
def cmd(x):
    c.write(x.encode()+b"\n");time.sleep(0.3);return c.read(c.in_waiting or 1)
t=TinySA();F0=2320.2e6-1586;f=t.setup(F0-25e3,F0+25e3,rbw="1",points=201)
rows=[];T0=time.time()
def log_for(sec,phase,cyc):
    end=time.time()+sec
    while time.time()<end:
        d=t.trace()+30;fc,l=peak(f,d)
        if l>-20:
            rows.append((time.time()-T0,phase,cyc,fc-2320.2e6,l));print(f"{rows[-1][0]:6.1f} {phase} {cyc} {fc-2320.2e6:+8.0f} Hz {l:5.1f} dBm",flush=True)
try:
    cmd("CW ON"); log_for(180,"cont",0); cmd("CW OFF"); time.sleep(10)
    for k in range(1,7):
        cmd("CW ON"); log_for(10,"ptt",k); cmd("CW OFF"); time.sleep(10)
finally:
    cmd("CW OFF");t.close();c.close()
r=np.array([(a,0 if p=="cont" else 1,k,e,l) for a,p,k,e,l in rows])
np.savetxt("docs/s3-trx/c3_plain_drift.csv",r,delimiter=",",fmt="%.1f,%d,%d,%.0f,%.2f",header="t_s,ptt,cycle,err_hz,dbm",comments="")
import matplotlib;matplotlib.use("Agg");import matplotlib.pyplot as plt
fig,ax=plt.subplots(figsize=(10,4.5))
m=r[:,1]==0;ax.plot(r[m,0],r[m,3],".-",ms=3,label="continuous carrier")
for k in range(1,7):
    m=r[:,2]==k;ax.plot(r[m,0],r[m,3],".-",ms=3,color="C1",label="PTT 10 s on / 10 s off" if k==1 else None)
ax.set_xlabel("s");ax.set_ylabel("Hz from 2320.200 MHz (tinySA)");ax.grid(alpha=.3);ax.legend()
ax.set_title("XIAO ESP32-C3, plain crystal, CW carrier AMP 50 (cw-beacon fw)",fontsize=9);fig.tight_layout();fig.savefig("docs/s3-trx/c3_plain_drift.png",dpi=110)
print("done")
