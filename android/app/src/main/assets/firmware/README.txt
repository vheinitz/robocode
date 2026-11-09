MicroPython-Firmware hier ablegen (Merged-Bin, Offset 0x0):

  micropython-esp32c3.bin   <- für ESP32-C3
  micropython-esp32s3.bin   <- für ESP32-S3

Bezug: https://micropython.org/download/  (passenden Chip wählen, .bin laden)

Die Dateinamen müssen exakt stimmen (siehe Board.firmwareAsset in Boards.kt).
Diese Bins sind groß (~1.5 MB) und werden bewusst NICHT im Git mitgeführt.
