MicroPython-Firmware (Merged-Bin, Offset 0x0) — wird in die APK gepackt:

  micropython-esp32c3.bin   <- ESP32-C3
  micropython-esp32s3.bin   <- ESP32-S3

Diese .bin-Dateien liegen bewusst NICHT im Git (zu groß, siehe .gitignore).
Vor dem Bauen einmal laden:

  android/fetch-firmware.sh      (holt die aktuelle Stable von micropython.org)

Stand Skript: MicroPython v1.29.0. Die Dateinamen müssen exakt stimmen
(siehe Board.firmwareAsset in Boards.kt).
