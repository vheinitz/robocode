# RoboCode — Roadmap / Feature-Todo

Stand: 2026-11-11.

**Quelle:** zwei ChatGPT-Unterhaltungen von Valentin Heinitz (10.11.2026) —
„Идеи программ" (Lernmodus, Bibliothek, grafisches Dashboard) und der
ESP32-Teil von „Публикация приложения в App Store" (Veröffentlichung,
Browser-Flasher). Der Vokabel-OCR-Teil des zweiten Chats gehört zu einem
anderen Projekt und ist hier bewusst nicht enthalten.

**Reihenfolge-Vorschlag:** 1 → 2 → 3 → 4 → 5. Dashboard (1) und
Components/Devices (2) bringen am schnellsten sichtbaren Mehrwert fürs Kind.

---

## 1 · Grafisches Terminal / Dashboard über den LOG-Kanal
*Erweitert das bestehende Text-Terminal — kein neues Protokoll.*

- [ ] ESP32 sendet weiter Text: `log("DIST:24")`, `log("TEMP:23.5")`
- [ ] Kind legt in der App Anzeige-Elemente **mit Namen + Bereich** an:
  `GAU DIST 0..100` (Zeiger), `BAR TEMP 0..50` (Balken), `TXT STATUS` (Text),
  `LED`, Digital-Tableau
- [ ] App ordnet eingehende `NAME:wert` dem passenden Widget zu, aktualisiert live
- [ ] Regeln: unbekannter Name → bleibt im Text-Terminal; **ein Name darf
  mehrere Widgets** speisen; App hält **History → Mini-Graph** (nicht nur den
  letzten Wert); Update-Rate bei viel Traffic begrenzen
- [ ] Ergebnis: Kind baut sich selbst eine „Armaturentafel"
  (Distanz-Zeiger, Thermometer, Ampel-LEDs)

## 2 · Bibliothek in Schichten: Board → Components → Devices → Applications
*Erweitert `firmware/robopy.py` (und die synchrone Android-Kopie).*

- [ ] **Components** (kleine eigene Wrapper, keine großen Arduino-Libs):
  `Led` (on/off/toggle), `Button` (pressed/released),
  `AnalogInput` (read/normalized), `Buzzer` (beep/tone), `Servo` (angle),
  `Temperature` (read), `Distance` (cm), `Display` (text/clear),
  `Motion`, `RGB`
- [ ] **Devices** (kombiniert): `Thermometer`, `TrafficLight`, `ParkingRadar`, `Robot`
- [ ] **I²C als eigener Layer** für Displays/Sensoren
- [ ] Interfaces: GPIO · ADC · PWM · I²C zuerst, später SPI · UART
- [ ] Treiber: **BME280** (Temp/Feuchte/Druck), **SSD1306** (OLED),
  **MPU6050** (Wasserwaage/Neigung/Schrittzähler), **VL53L0X** (Abstand)
- [ ] Lernsprache soll lesbar werden: `READ TEMP`, `SHOW TEMP`
  (Komponente kümmert sich um den Rest)

## 3 · Web als echte Hardware-Umgebung
*Das Web-Playground kann bisher nur simulieren.*

- [ ] **Web Serial API** (Chrome): ESP32 per USB-OTG direkt aus dem Browser
  verbinden und MicroPython-Programme senden
- [ ] **esptool-js**: Erst-Flashen der MicroPython-Firmware aus dem Browser
- [ ] **PWA**: offline-fähig, auf Homescreen installierbar
- [ ] Rollenverteilung festschreiben: **Android-APK = Erst-Flasher**,
  **Web/PWA = Haupt-Programmierumgebung**, **ESP32 = Ausführung** — kein Entweder-oder

## 4 · Interaktiver Lern-Modus (Schritt-für-Schritt)
*Neuer Modus.*

- [ ] Pro Lektion eine Seite mit **Pinout + Fotos** (ESP32, Bauteil, Breadboard) + Anweisung
- [ ] Pro Schritt zwei Wege: **„Selbst probieren"** → Editor, oder
  **„Beispiel übernehmen"** → lauffähiges Beispiel wird in den Editor kopiert
- [ ] **Jeder Schritt ist schon lauffähig** (kompiliert & tut sichtbar etwas),
  dann nächster Schritt
- [ ] Pinout **an Board-Modell gebunden**, nicht in die Lektion hartkodiert
- [ ] 3 unabhängige Teile: Lern-Engine · Hardware-Nachschlagewerk · Editor-Executor
- [ ] ~15 Projekte als Reihe: Blink · Taster-Toggle · Poti→PWM · Piezo-Melodie ·
  Servo 0/90/180 · DHT11→Handy · An/Aus-Menü · Reaktionsspiel · Zähler ·
  Nachtlicht (Fotowiderstand) · HC-SR04 Abstand · Taster→Servo+Piezo ·
  Fußgängerampel · Countdown · Finale: Futterstation (Servo + Taster + Portionszähler)

## 5 · Veröffentlichung / Distribution

- [ ] **Google Play** für die APK (Eltern mit **Family Link** geben einmalig
  frei; Sideloading/Dev-Mode ist für Kinder oft blockiert)
- [ ] Altersfreigabe über **IARC**-Fragebogen (niedrigste Stufe erwartet)
- [ ] APK offline/autonom (MicroPython-Flashen via USB-OTG eingebaut)
- [ ] Web-PWA auf **GitHub Pages** (gratis HTTPS, kein Server, keine Signatur, keine Werbung)

---

Zielplatinen und Pinouts: siehe [`docs/boards/`](boards/README.md).
