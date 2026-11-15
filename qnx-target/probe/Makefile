# Build template for QNX 8.0 programs in this repo (Dev 2 copies it for sim/qnx-load/).
#
#   source <path-to>/qnx800/qnxsdp-env.sh
#   make                    # x86_64 for QEMU      -> out/x86_64/pulse-probe
#   make ARCH=aarch64le     # Raspberry Pi 5       -> out/aarch64le/pulse-probe
#   make clean
#
# Only source and this Makefile are committed. Never commit SDP headers, libraries or binaries.

ARCH    ?= x86_64
TARGET  := pulse-probe
SRCS    := pulse_probe.c
OUT     := out/$(ARCH)

CC      := qcc
CFLAGS  := -Vgcc_nto$(ARCH) -std=gnu11 -O2 -Wall -Wextra
LDFLAGS := -Vgcc_nto$(ARCH)

.PHONY: all clean check-env

all: check-env $(OUT)/$(TARGET)

check-env:
	@test -n "$$QNX_TARGET" || { echo "QNX_TARGET not set: source qnxsdp-env.sh first"; exit 1; }

$(OUT)/$(TARGET): $(SRCS) | $(OUT)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $(SRCS)

$(OUT):
	mkdir -p $@

clean:
	rm -rf out
