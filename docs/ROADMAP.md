# RoboCode — Roadmap

Stand: 2026-11-12.

RoboCode senkt die Einstiegshürde, damit Kinder Mikrocontroller programmieren:
mit **Handy, OTG-Kabel und ESP32** den ESP32 vom Handy flashen und eigene kleine
Programme in einer **fürs Handy optimierten Syntax** schreiben, die autark auf
dem ESP32 laufen. Das Dashboard (Handy als Display) ist optional.

Feature-Details: siehe [`specs/robocode-konzept.md`](specs/robocode-konzept.md).

---

## ✓ Erledigt

### Projektverwaltung (Mehrprojekt-Ablage)
- [x] Aktuelle Arbeit als Projekt speichern; kurze Namen, fester Ort, keine Pfadeingabe
- [x] Implizites Default-Projekt — man kann ohne explizites Anlegen loslegen

### Board-Konfiguration
- [x] Zwischen Boards wählen (C3 SuperMini, S3 SuperMini, C3 SuperMini OLED)
- [x] Board als Bild mit Pin-Controls ringsum; fürs Projekt klonen, Pins umbenennen/Rolle wählen
- [x] Mit eigener Pin-Belegung programmieren, Symbole im Programm nutzen

### Tafel / Dashboard-Grundstein (über den LOG-Kanal)
- [x] `log("NAME:wert")` → Widgets (Zeiger/Balken/Text/LED); unbekannte Namen bleiben
  im Text-Terminal; History/Mini-Graph; Update-Rate begrenzt

### Web als Hardware-Umgebung
- [x] Web Serial (Chrome): ESP32 aus dem Browser verbinden, Programme senden
- [x] esptool-js: Erst-Flashen aus dem Browser; PWA (offline, installierbar)

---

## Priorität 1 — Kern-Erlebnis

### Projektverwaltung reparieren
- [ ] Speichern / Umbenennen / Kopieren / Neu / Öffnen klar getrennt
- [ ] „Kopieren" darf das Original **nicht** umbenennen; die Kopie bekommt einen eigenen Namen
- [ ] Namensfeld nicht als Nebenwirkung anderer Aktionen (Grundlage für die Startseite)

### Startseite (Project Launcher)
- [ ] Start zeigt eine Projektliste (Neu / Fortsetzen / Öffnen) statt direkt den Editor
- [ ] Projekte mit Dashboard direkt startbar; ohne Dashboard → Editor

### Editor — Syntax-Highlighting
- [ ] Standard-Python-Highlighting über eine fertige Editor-Komponente (z. B. Sora Editor)
- [ ] Optional: Hardware-Objekte (`B.DI1`, `B.DO1`, analog) eingefärbt, dynamisch aus der Board-Config

### Programmieren mit KI
- [ ] Kontext (Syntax/API + Board-Config + optional aktuelles Programm) per `Intent.ACTION_SEND` an eine KI-App
- [ ] Anfrage-ID im Prompt; KI setzt sie in den Code-Kopf; Clipboard-Fallback; beim Zurückwechseln Antwort per ID zuordnen
- [ ] KI nutzt bestehende Board-Objekte, erfindet keine Pins

### Interaktiver Kurs (konzeptioneller Schwerpunkt)
- [ ] Ansicht mit Doku zu ~15 geführten Projekten
- [ ] Pro Schritt: Einführung (Bild/SVG-Animation, Text oder TTS) → Board-Konfiguration
  (selbst in der Board-Ansicht oder per „Make") → Code-Beispiel (selbst schreiben oder
  einfügen lassen) → Experimente (Kind ändert Timings/Parameter selbst)
- [ ] Jeder Schritt ist lauffähig (kompiliert & tut sichtbar etwas); Pinout ans Board-Modell gebunden
- [ ] Symbolische Komponenten: eine Komponente als Rechteck + Icon an die Pins andocken (ohne Schaltplan)
- [ ] Projektreihe: Blink · Taster-Toggle · Poti→PWM · Piezo-Melodie · Servo 0/90/180 ·
  DHT11→Handy · An/Aus-Menü · Reaktionsspiel · Zähler · Nachtlicht (Fotowiderstand) ·
  HC-SR04 Abstand · Taster→Servo+Piezo · Fußgängerampel · Countdown ·
  Finale: Futterstation (Servo + Taster + Portionszähler)

## Priorität 2 — Autarke Projekte / Geräte-Erkennung

### Projekt-Identifikation auf dem ESP32
- [ ] Manifest `robocode_project.json` (project_id UUID, version, deployment_hash, board_type)
- [ ] Firmware und Projekt trennen (einmal flashen, Projekte separat aktualisieren)

### Zuverlässige Geräte-Identifikation
- [ ] Request-Response `RC_IDENTIFY` → `RC_DEVICE_INFO` (nicht auf Startmeldungen verlassen)
- [ ] Gerätezustände unterscheiden; Timeout ≠ „kein Projekt"; `robocode_boot.py` erst nach Analyse

### Vorhandenes Projekt starten
- [ ] Board erkennen → Projekt/Version bestimmen → starten / ersetzen / Demo

## Priorität 2 — Dashboard (optional)

- [ ] Dashboard Designer: Edit-/Run-Modus, Instrumente platzieren & skalieren, Layout im Projekt
- [ ] Visual Components Integration: Editor-Gruppe fügt `publish(Name, wert)` ein (Quelle = Dashboard-Config)
- [ ] Runtime-/Demo-Modus (Dashboard als Handy-Display; Demo-Modus ohne Board)

## Priorität 3 — Drahtlos (Nice-to-have)

- [ ] Projekt-Update über Wi-Fi (WLAN einmalig über USB einrichten)
- [ ] OTA-Firmware über Wi-Fi (Flash-Partitionen, Recovery, Security) — deutlich später

## Veröffentlichung / Distribution

- [ ] **Google Play** für die APK (Eltern mit **Family Link** geben einmalig
  frei; Sideloading/Dev-Mode ist für Kinder oft blockiert)
- [ ] Altersfreigabe über **IARC**-Fragebogen (niedrigste Stufe erwartet)
- [ ] APK offline/autonom (MicroPython-Flashen via USB-OTG eingebaut)
- [ ] Web-PWA auf **GitHub Pages** (gratis HTTPS, kein Server, keine Signatur, keine Werbung)

---

Zielplatinen und Pinouts: siehe [`docs/boards/`](boards/README.md).
