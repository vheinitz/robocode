# RoboCode — native Android-App (ESP32 · MicroPython)

Parallel zum Web-Playground (`../src`). **Kein WebView** — Editor, Zusammenbau der
`main.py` und Übertragung laufen nativ in Kotlin. Teilt sich die DSL
(`firmware/robopy.py`, hier als Asset kopiert) mit dem Web-Playground.

## Ablauf
1. **Verbinden & prüfen** — ESP32 per USB-OTG (CDC) finden, prüfen ob MicroPython
   läuft (`MicroPythonRepl.isMicroPython`, über den Raw-REPL).
2. Falls **kein MicroPython**: **MicroPython installieren** — Firmware aus
   `assets/firmware/` flashen (`EspLoader`, ROM-Protokoll; Board vorher per
   BOOT/EN in den Download-Modus bringen — die App sagt es an).
3. Falls **MicroPython da**: in SETUP/MAIN/LIB programmieren, **▶ Start** baut die
   eine `main.py` zusammen (`Assembler`: versteckte DSL + vordefinierte Pins +
   SETUP + LIB + MAIN), überträgt sie per Raw-REPL (base64-Chunks), speichert sie
   als `main.py` und startet sie per Soft-Reset (läuft dann bei jedem Boot).

## Struktur
- `EspLoader.kt`, `UsbSerialLink.kt` — aus `../../espflasher` übernommen
  (esptool-ROM-Protokoll über USB-CDC; jedes `.bin` flashbar, auch MicroPython).
- `MicroPythonRepl.kt` — NEU: Erkennung + Datei-Upload + Start über den Raw-REPL.
- `Boards.kt` — ESP32-C3 / ESP32-S3 (Pin-Ausschnitt, ADC), vordefinierte Pins.
- `Assembler.kt` — Port von `../src/hw/assemble.ts` (baut die `main.py`).
- `MainActivity.kt` — native UI (3 Tabs, Token-Palette, Board-Wahl, Log).
- `assets/dsl/robopy.py` — Kopie von `../firmware/robopy.py` (die DSL).

## Bauen
In **Android Studio** `android/` öffnen und auf ein Gerät mit USB-OTG
installieren. (Abhängigkeit `usb-serial-for-android` via JitPack.)

## Firmware bereitstellen (einmalig)
MicroPython-Bins von <https://micropython.org/download/> laden und ablegen als
`app/src/main/assets/firmware/micropython-esp32c3.bin` bzw. `…s3.bin`
(nicht im Git, siehe `.gitignore`).

## Status
Code vollständig und in sich schlüssig, aber **noch nicht auf Gerät getestet**
(hier keine Android-SDK/Hardware). Zu prüfen auf echtem ESP32: Raw-REPL-Timing,
Soft-Reset-Verhalten über natives USB, und die Pin-Listen in `Boards.kt`.
`firmware/robopy.py` → `assets/dsl/robopy.py` wird manuell synchron gehalten.
