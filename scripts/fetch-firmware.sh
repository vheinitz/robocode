#!/usr/bin/env bash
# Lädt die MicroPython-Firmware (Merged-Bin @0x0) nach public/firmware/, damit
# der Browser-Flasher (esptool-js, Roadmap 3) sie ausliefern kann. Die Bins
# liegen bewusst NICHT im Git (zu groß, siehe .gitignore). Einmal ausführen,
# wenn man im Web erst-flashen will — sonst übernimmt die Android-APK das
# Erst-Flashen (siehe Rollenverteilung im README).
#
# Dieselben Dateinamen wie Androids android/fetch-firmware.sh (firmware.ts
# bildet board.chip -> micropython-<chip>.bin ab).
set -euo pipefail
cd "$(dirname "$0")/../public/firmware"

VER="v1.29.0"
DATE="20260824"
BASE="https://micropython.org/resources/firmware"

dl() { # <chip-suffix> <zielname>
  local url="$BASE/ESP32_GENERIC_$1-$DATE-$VER.bin"
  echo "Lade $2  ($url)"
  curl -fSL -o "$2" "$url"
  local first; first=$(head -c1 "$2" | xxd -p)
  [ "$first" = "e9" ] || { echo "FEHLER: $2 ist kein ESP-Image (Magic=$first)"; exit 1; }
  echo "  ok, $(wc -c < "$2") Byte"
}

dl C3 micropython-esp32c3.bin
dl S3 micropython-esp32s3.bin
echo "Fertig. Firmware liegt in public/firmware/ und wird vom Browser-Flasher genutzt."
