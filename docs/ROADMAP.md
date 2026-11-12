# RoboCode — Roadmap / Feature-Todo

Stand: 2026-11-11.

**Quelle:** zwei ChatGPT-Unterhaltungen (Lernmodus, Bibliothek, grafisches Dashboard) und der
ESP32-Teil von  (Veröffentlichung,
Browser-Flasher)


---

## 0.1 · Projektverwaldung. Nach neuinstallation projekte verschwinden nicht

- [ ] Aktuelle arbeit kann man als neues projekt abspeichern
- [ ] Projekte werden kutzgenannt ind im definierten Ort abgelegt ohne Verzeichnis eingabe
- [ ] Man kann auch loslegen ohne projkt explizit anzulegen es ist implizit ein default-projekt was auch so abgespeichert wird

## 0.2 · Board-Konfiguration

- [ ] Zwischen definierten Boards auswählen
- [ ] Board wird angezeigt als Bild, mit einem kleinen Button kann man die Boardansicht immer wieder anzeigen
- [ ] Rund herum um das Boardbild sind die Edit-line controls, die Pin-Definitionen zeigen mit den Defaultname An, DIn, DOn
- [ ] Man kann das Board clonen fürs Projekt und die Pind-namen umdefinieren - Name Vergeben sowie bedeutung auswählen (A,D, in/out, I2C, SPI, Interrupt, etc)
- [ ] Mit der neuen Pinbelegung kann man nun programmieren und die Symbole im Programm nutzen
- [ ] Unterstützt sollten jetzt sein C3 supermini, S3 supermini und C3 supermini oled

## 1 · Grafisches Terminal / Dashboard über den LOG-Kanal
*Erweitert das bestehende Text-Terminal — kein neues Protokoll.*

- [x] ESP32 sendet weiter Text: `log("DIST:24")`, `log("TEMP:23.5")`
- [x] Kind legt in der App Anzeige-Elemente **mit Namen + Bereich** an:
  `GAU DIST 0..100` (Zeiger), `BAR TEMP 0..50` (Balken), `TXT STATUS` (Text),
  `LED`, Digital-Tableau
- [x] App ordnet eingehende `NAME:wert` dem passenden Widget zu, aktualisiert live
- [x] Regeln: unbekannter Name → bleibt im Text-Terminal; **ein Name darf
  mehrere Widgets** speisen; App hält **History → Mini-Graph** (nicht nur den
  letzten Wert); Update-Rate bei viel Traffic begrenzen
- [x] Ergebnis: Kind baut sich selbst eine „Armaturentafel"
  (Distanz-Zeiger, Thermometer, Ampel-LEDs)

*Erledigt 2026-11-11 (Android, Commit d3fadfb): Tafel-Modus im Terminal.*


## 2 · Bibliothek der Componente 
*Jenseits von DI, DO, AI*

- [ ] **Components** (kleine eigene Wrapper, die die logik der angeschlossener HW kennen oder interne HW steuern):
  `Led` gegen Gnd (on/off/toggle), `Button` gegen GND mit default pullup mit entprellung (pressed/released),
  `Servo` (angle), 'DC Motor' über H-Bridge CW/CCW, Power, en/dis
   `RGB`-Led 'I2C'/ One wire/ sensoren mit default addr, eingebaute LED und Buttons
- [ ] EEPROM-Speicher intern
- [ ] RTC
- [ ] BT
- [ ] ESPNOW
- [ ] WIFI
  (Komponente kümmert sich um den Rest)

## 3 · Programmierung durch KI

- [ ] Kind definiert anschluesse, welche komponente wo hängt dann ruft er über Android eine andere APP mit KI agent (Gemini, CHatgpt, etc) und übergibt an das agent einen Prompt als weiterleitung
- [ ] Prompt beschreibt was die app kann, beschreibt das verfügnare syntax und evtl den inhalt von main.py mit ausdrücklicher bitte es nicht zu ändern. Das app übergibt auch die aktuelle HW konfiguration board und an welchen pins was hängt mit der Bitte eine RÜckmeldung zu geben, ob ki agent das system versteht und auf die Anweisung zum Programmieren eines scatches in
erlaubtem kurzem syntax wartet. 
- [ ] Danach kann deas Kind KI sagen oder schreiben was es programmieren will, und bitten es so abzulegen, dass man mit einem klick in zwischenablage übernehmen kann.
- [ ] Das kind übernimmt das KI code in die zwischenablage und wechselt zu RoboCode. RoboCode beim Aktivieren liest automatisch die Zwischenablage, prüft nach einem Kopf-zeichenkette, ob es KI code ist (kann man KI auch unikate keys geben und bitten dass es als kommentaren oder einfach so (muss ja nicht mit ins code hinzukommen)) und ggf ersetzt das alte code damit
 So braucht man kein KI API zu programmieren um auf KI zurückzugreifen


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

## ✓ Erledigt · Web als echte Hardware-Umgebung
*Der Web-Playground spricht den ESP32 jetzt direkt an. Erledigt 2026-11-12, Commit ccf9cdf.*

- [x] **Web Serial API** (Chrome): ESP32 per USB-OTG direkt aus dem Browser
  verbinden und MicroPython-Programme senden
- [x] **esptool-js**: Erst-Flashen der MicroPython-Firmware aus dem Browser
- [x] **PWA**: offline-fähig, auf Homescreen installierbar
- [x] Rollenverteilung festschreiben: **Android-APK = Erst-Flasher**,
  **Web/PWA = Haupt-Programmierumgebung**, **ESP32 = Ausführung** — kein Entweder-oder

---

Zielplatinen und Pinouts: siehe [`docs/boards/`](boards/README.md).
