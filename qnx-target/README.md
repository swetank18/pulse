# qnx-target (Dev 3)

Real-time core of PULSE on QNX 8.0. It must build and run on its own, in a terminal, with no
Atlassian dependency.

| Path | What | Phase |
|---|---|---|
| `probe/` | `pulse-probe`: SCHED_FIFO + timer pulses + `ClockCycles()` hello world; also the build template | 0 |
| `core/` | `pulse-core`: periodic tasks, measurement, kernel event tracing, evidence JSON | 1 |

## Phase 0 setup (host: Ubuntu)

Steps marked *verify* are from memory of the SDP 8.0 docs. Check them against the docs installed
with the SDP, and fix this file when they differ.

1. **Licence and SDP.** Create a myQNX account, get the free non-commercial licence, install the
   QNX Software Center, then install **QNX SDP 8.0** (default location `~/qnx800`).
2. **Environment.** Run this in every shell: `source ~/qnx800/qnxsdp-env.sh`. Then `which qcc`
   should print a path.
3. **QEMU with KVM.**
   `sudo apt install qemu-system-x86 qemu-utils bridge-utils`. Check that `/dev/kvm` exists, and
   add yourself to the `kvm` group.
4. **Target image** (*verify*). The SDP ships `mkqnximage`. From an empty working folder:
   `mkqnximage --type=qemu --arch=x86_64 --build --run`. Log in on the console, and note the
   target IP for `scp`/`ssh`.
5. **Build and run the probe.**
   ```bash
   cd qnx-target/probe && make
   scp out/x86_64/pulse-probe root@<target-ip>:/tmp/
   ssh root@<target-ip> /tmp/pulse-probe 1000 5000 50
   ```
   Expected result: a line of interval statistics, then `pulse-probe: OK`.

**Phase 0 is done for QNX** once the probe prints OK on QEMU. Record the output (tick size, worst
deviation) in the daily sync. Notes:

* The default QNX tick limits how precise the timer can be. If the worst deviation is close to
  `tick`, that is expected. `pulse-core` measures latency from the scheduled release, so the
  tick becomes part of the measured latency, not a measurement error.
* Never commit the SDP, the target image (`*.ifs`, `*.img`, `*.qcow2`) or licence files.
  `.gitignore` blocks the usual names.
