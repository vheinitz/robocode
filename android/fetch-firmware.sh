#!/usr/bin/env bash
# Lädt die MicroPython-Firmware (Merged-Bin @0x0) in die App-Assets, damit sie
# beim Bauen in die APK gepackt wird. Die Bins liegen bewusst NICHT im Git
# (zu groß, siehe .gitignore). Vor dem ersten Build einmal ausführen.
#
# Version anpassen, wenn eine neuere Stable gewünscht ist (micropython.org).
set -euo pipefail
cd "$(dirname "$0")/app/src/main/assets/firmware"

VER="v1.29.0"
DATE="20260824"
BASE="https://micropython.org/resources/firmware"

dl() { # <chip> <zielname>
  local url="$BASE/ESP32_GENERIC_$1-$DATE-$VER.bin"
  echo "Lade $2  ($url)"
  curl -fSL -o "$2" "$url"
  local first; first=$(head -c1 "$2" | xxd -p)
  [ "$first" = "e9" ] || { echo "FEHLER: $2 ist kein ESP-Image (Magic=$first)"; exit 1; }
  echo "  ok, $(wc -c < "$2") Byte"
}

dl C3 micropython-esp32c3.bin
dl S3 micropython-esp32s3.bin
echo "Fertig. Jetzt die App bauen — die Bins landen in der APK."
