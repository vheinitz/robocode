# RoboCode — Konzept & Spezifikation

Detailbeschreibung der geplanten Features. Die priorisierte Reihenfolge der
Umsetzung steht in [`../ROADMAP.md`](../ROADMAP.md); dieses Dokument beschreibt,
*was* die einzelnen Punkte bedeuten.

## 1. Vision

RoboCode senkt die Einstiegshürde, damit Kinder Mikrocontroller programmieren
können. Mehr als **Handy, OTG-Kabel und ESP32** braucht man zunächst nicht.
Kernablauf:

1. Den ESP32 vom Handy aus mit MicroPython flashen.
2. Eigene kleine Programme schreiben — in einer fürs Handy optimierten Syntax
   (Eingabe über Knöpfe, kurze klammerarme Schreibweise).
3. Das Programm läuft autark auf dem ESP32.

Elektronische Komponenten und Sensoren kommen später. Ein typisches Szenario ist
der Bau **kleiner eigenständiger Geräte**. Das Dashboard (Handy als Display) ist
ein **optionales** Szenario, nicht der Kern. Wi-Fi ist kein Architekturprinzip,
sondern nur ein späterer, optionaler Update-Kanal.

## 2. Editor — Syntax-Highlighting

RoboCode-Programme sind gültiger, kompilierbarer Python-Code. Darum genügt
**Standard-Python-Highlighting**; ein eigener Parser ist nicht nötig.

- Eine fertige Editor-Komponente nutzen (z. B. Sora Editor), statt Text in einem
  einfachen Eingabefeld selbst einzufärben. Zuerst prüfen, ob die Bibliothek zu
  den Android-/Kotlin-Versionen des Projekts passt und ohne größeren Umbau
  integrierbar ist.
- Pflicht: Python-Schlüsselwörter, Strings/Kommentare, Zahlen, Bezeichner;
  Zeilennummern, automatische Einrückung, Klammer-Paare; helles/dunkles Theme
  passend zur App.
- Optional: Hardware-Objekte (`B.DI1`, `B.DO1`, analoge Ein-/Ausgänge) anders
  einfärben als gewöhnliche Bezeichner. Die gültigen Namen **dynamisch aus der
  Board-Konfiguration** beziehen, nicht hartkodieren. Wenn der Aufwand zu groß
  wird, weglassen — Standard-Python-Highlighting hat Vorrang.
- Reine Editor-Funktion: ändert nie den ausgeführten Code. Programm-Laden,
  -Speichern und -Ausführen bleiben unverändert.

## 3. Programmieren mit KI

Ein neutraler Knopf (Sternchen-Icon) im Editor macht eine externe KI zum
Programmierhelfer, ohne dass RoboCode eine KI-API einbinden muss. Der Ablauf ist
bewusst dialogfrei und läuft in einer Runde.

Ablauf:

1. Beim Tippen legt RoboCode den fertigen Kontext zuerst in die **Zwischenablage**
   (Sicherheit, falls die Ziel-App das Textfeld nicht automatisch füllt) und
   öffnet dann direkt die **Teilen-Auswahl** — ohne Zwischendialog.
2. Die Auswahl ist auf **KI-Apps eingegrenzt**: RoboCode fragt über die
   Paket-Sichtbarkeit (`<queries>` für `ACTION_SEND`/`text/plain`) die installierten
   Apps ab und zeigt nur die aus einer gepflegten Liste bekannter KI-Apps (ChatGPT,
   Claude, Gemini, Copilot, Perplexity, DeepSeek, Grok …). Ist genau eine
   installiert, öffnet sie direkt; ist keine bekannt, bleibt die normale Auswahl.
3. Der Kontext selbst **erklärt RoboCode** (siehe unten) und bittet die KI, das
   Verständnis mit „ja" zu bestätigen. Die eigentliche **Aufgabe** gibt der Nutzer
   erst danach in der KI-App ein — per Sprache oder Text. Die KI antwortet mit
   einem kopierbaren Python-Codeblock, dessen **allererste Zeile die Anfrage-ID**
   als Kommentar wiederholt (`# RC-ID: …`).
4. Der Nutzer kopiert den Code und kehrt zu RoboCode zurück. Beim Zurückkehren
   (Fensterfokus) prüft RoboCode **ohne Dialog** die Zwischenablage: Enthält sie
   die Anfrage-ID, ersetzt es sofort das Programm (MAIN) mit dem Code und **leert
   die Zwischenablage**. Danach ist die Anfrage entschärft — die nächste Aufgabe
   startet über einen erneuten Stern-Tipp (so wird nicht bei jeder Rückkehr zur
   App die Zwischenablage gelesen).

Robust gegen App-Beendigung: Beim Stern-Tipp wird MAIN geleert (der alte Stand
steckt im Kontext) und die offene Anfrage-ID **dauerhaft** gemerkt. Beendet das
System RoboCode im Hintergrund, während man in der KI-App ist, erkennt die App
die Antwort nach dem Neustart trotzdem an der gemerkten ID.

Inhalt des Kontexts (Prompt):

- RoboCode wird genau beschrieben: Es ist **gültiger Python-Code** (MicroPython),
  nur mit einer **kurzen, handy-freundlichen Schreibweise** — keine eigene Sprache.
- Die Bedienung der Hardware: `b.do0 = 1/0` (Digitalausgang), `b.di0`
  (Digitaleingang), `b.a0` (Analogeingang), `wait(ms)`, `log("NAME:" + str(wert))`
  für die Tafel. Dazu normales Python (Schleifen, Bedingungen, Funktionen).
- Die **vorhandenen Board-Objekte des Projekts** (welche `b.do*/di*/a*` es gibt,
  eigene Pin-Namen, eingebaute Bauteile `led`/`b1`, siehe Abschnitt Eingebaute
  Bauteile). Die KI soll **nur diese** nutzen und keine Pins anlegen.
- Die **vorhandenen Tafel-Anzeigen** (Name, Typ, Bereich, beim Oszilloskop die
  Kanäle), damit die KI die passenden `log("NAME:" + str(wert))`-Zeilen einbaut.
- Optional das **aktuelle Programm**, um ein bestehendes zu erweitern.
- Die Anfrage-ID erzeugt RoboCode; die KI wiederholt sie nur als erste Code-Zeile.

Die reine Logik (Prompt bauen, Antwort an der ID herausschneiden, App-Liste)
liegt in `AiAssist.kt` und ist ohne Android testbar.

## 4. Interaktiver Kurs

Konzeptioneller Schwerpunkt: eine Ansicht mit Doku zu ~15 didaktisch gewählten
Projekten (z. B. Blinken, Taster-Toggle, Poti→PWM, Nachtlicht, Abstand, Ampel …).
Jedes Projekt führt Schritt für Schritt und ist **in jedem Schritt lauffähig**.

Pro Projekt/Schritt:

1. **Einführung** als Bild/SVG-Animation, Text oder Ton (TTS) — z. B. ein ESP32
   mit den anzuschließenden Bauteilen.
2. **Board-Konfiguration.** Das Kind kann entweder selbst in die Board-Ansicht
   wechseln und die Komponenten andocken, oder in der Doku **„Make"** tippen —
   dann richtet RoboCode die Konfiguration ein.
3. **Code-Beispiel.** Wieder zwei Wege: selbst schreiben oder von der App
   einfügen lassen.
4. **Experimente.** Kleine Aufgaben, z. B. die Timings beim Blinken oder andere
   Parameter ändern, ohne die Code-Struktur groß zu ändern. Das macht das Kind
   selbst; die App darf **nicht** annehmen, dass der Code exakt dem Beispiel
   entspricht.

Mehrschrittige Beispiele: Jeder Schritt kompiliert und tut sichtbar etwas, dann
folgt der nächste. Das Pinout ist an das Board-Modell gebunden, nicht in die
Lektion hartkodiert. Sinnvolle Trennung: Lern-Engine · Hardware-Nachschlagewerk ·
Editor/Ausführung.

## 5. Symbolische Komponenten

Für Board-Konfiguration und Kurs: Eine Komponente wird **symbolisch** als
Rechteck mit Icon an die Pins angedockt — **ohne** vollständigen Schaltplan.
Das reicht, um dem Kind zu zeigen, was wo hängt, und ist die Grundlage für die
„Make"-Board-Konfiguration im Kurs. Komponenten tragen symbolische Namen, über
die sie im Programm angesprochen werden.

### Eingebaute Bauteile (board-abhängige Aliase)

Je Board stellt die DSL feste Aliase für die auf der Platine verbauten Teile
bereit — immer vorhanden, ohne dass das Kind sie anlegt:

- `led` — eingebaute LED (meist aktiv-low, Logik wird intern invertiert):
  `led.v = 1` (an) / `led.v = 0` (aus).
- `b1` — BOOT-Taste als Taster: `if b1: …`.
- Die Reset/EN-Taste lässt sich nicht per GPIO lesen (kein `b2`).

Konkret: C3/C3-OLED und (für die LED analog) der S3-Teil — LED an GPIO8, BOOT an
GPIO9 (C3) bzw. GPIO0 (S3). Beim S3 ist die eingebaute LED eine RGB-LED (WS2812)
und daher kein einfacher `led`-Ausgang.

## 6. Startseite / Project Launcher

Die Startseite ist eine **Projektliste** statt direkt der Editor:

- Neues Projekt · Letztes Projekt fortsetzen · gespeichertes Projekt öffnen.
- Projekte, die ein Dashboard enthalten, lassen sich direkt starten (siehe
  Runtime-Modus); Projekte ohne Dashboard öffnen im Editor.

Voraussetzung ist eine saubere Projektverwaltung (Speichern/Umbenennen/Kopieren
klar getrennt).

## 7. Dashboard (optional)

Ein Dashboard macht aus einem Projekt ein kleines Gerät mit Oberfläche. Optional,
nicht Teil des Kerns.

- **Zwei Modi.** Edit-Modus: Instrumente aus einer Liste platzieren, über
  Eckmarker skalieren, verschieben, Eigenschaften einstellen. Run-Modus: Marker
  verschwinden, die Instrumente zeigen Echtzeitdaten.
- **Layout im Projekt gespeichert** (pro Instrument: Position, Größe, Typ,
  Kanalname, Einstellungen), damit die Tafel bei jedem Start gleich aussieht. In
  Kotlin per Canvas zeichenbar.
- **Instrumente:** Zahl, Zeiger (Gauge), Balken, LED, Oszilloskop. Baut auf der
  bestehenden „Tafel" auf. Zeiger/Balken/Oszilloskop haben einen Wertebereich
  (min/max); Zeiger und Balken zeigen zusätzlich eine kurze Verlaufskurve.
- **Oszilloskop (mehrkanalig).** Ein Widget zeichnet mehrere Kanäle über die Zeit
  in ein gemeinsames Gitter, jeder Kanal in eigener Farbe mit Legende. Die Kanäle
  stehen als mit Komma getrennte LOG-Namen im Namensfeld (z. B. `ax,ay`); gespeist
  wird wie bei jedem Widget über `log("ax:" + str(wert))`.
- **Vollbild.** In der Tafel-Ansicht blendet ein Knopf Titel-, Navigations- und
  Terminal-Leiste aus und zeigt nur die Widgets; ein schwebender Knopf kehrt zurück.
- **Visual Components Integration (Editor).** Eine Editor-Gruppe „Visual
  Components" listet die im Dashboard konfigurierten Komponenten; bei Auswahl fügt
  der Editor einen fertigen `publish(Name, wert)`-Aufruf an der Cursorposition
  ein. Einzige Quelle der Namen ist die Dashboard-Konfiguration (kein manuelles
  Doppeln, kein Hartkodieren). Gewöhnliches `log()` bleibt unverändert.
- **Demo-Modus.** Das Dashboard lässt sich auch **ohne** angeschlossenes Board mit
  Testdaten starten (Vorführen, auch ohne Hardware).

## 8. Projekt-Identifikation auf dem ESP32

Damit RoboCode erkennt, welches Projekt in welcher Version auf einem Board liegt:

- Beim Übertragen ein Manifest `robocode_project.json` mitspeichern:

  ```json
  {
    "project_id": "<persistente UUID>",
    "project_name": "...",
    "project_version": "1.3",
    "deployment_hash": "<Inhalts-Hash>",
    "board_type": "ESP32-C3",
    "robocode_protocol_version": 1
  }
  ```

  `project_id` bleibt konstant, `deployment_hash` ändert sich mit dem Inhalt — so
  erkennt RoboCode das Projekt und weiß zugleich, ob eine Aktualisierung nötig ist.
- **Firmware und Projekt trennen:** MicroPython wird einmal pro Boardtyp geflasht;
  Projekte werden separat übertragen/aktualisiert — kein erneutes Flashen beim
  Projektwechsel.
- Bestehende Projekte ohne Manifest müssen weiter funktionieren.

## 9. Geräte-Identifikation (Serial-Timing)

Problem: Der ESP32 beginnt sein Programm schon vor dem Öffnen des Serial-Ports;
unaufgeforderte Startmeldungen gehen verloren. Deshalb **nicht** darauf verlassen.

- **Request-Response:** Nach dem Verbinden fragt das Handy aktiv an —
  `RC_IDENTIFY` → der ESP32 antwortet `RC_DEVICE_INFO { project_id, version,
  state }`. Funktioniert unabhängig davon, wann der Port geöffnet wurde.
- Zuerst klären, ob der bestehende Serial-Log **bidirektional** ist oder ein
  separater Befehlskanal nötig ist. Antworten dürfen nicht mit normalem
  Log-Output vermischt werden.
- **Gerätezustände** unterscheiden: Firmware fehlt/inkompatibel · MicroPython ohne
  RoboCode-Projekt · Projekt installiert, läuft nicht · Projekt läuft · Identität
  unbekannt · Kommunikationsfehler. Ein Timeout bedeutet **nicht** „kein Projekt".
- Ein kleines Startmodul `robocode_boot.py` (lädt Metadaten, startet das
  Nutzerprogramm, beantwortet Identifikationsanfragen) ist eine Option — aber
  **erst** nach Analyse des bestehenden Startmechanismus einführen, ohne
  bestehende Projekte zu brechen.

## 10. Drahtlos (Nice-to-have)

Niedrige Priorität, optionaler Update-Kanal — kein Architekturprinzip. USB bleibt
der Standardweg und muss ohne Netz vollständig funktionieren (Kurse ohne WLAN).

- **Phase 1 — Projekt-Update über Wi-Fi.** WLAN einmalig über USB einrichten;
  danach Projektdateien per WLAN aktualisieren und das Programm neu starten (der
  ESP32 kann im fertigen Gerät verbaut bleiben). Die Projekt-Identifikation aus
  Abschnitt 8/9 wiederverwenden, Transport-unabhängig halten — aber keine
  Über-Abstraktion nur für Hypothetisches.
- **Phase 2 — OTA.** MicroPython-Firmware selbst per WLAN aktualisieren
  (Flash-Partitionen, Wiederherstellung nach Fehlschlag, Sicherheit). Deutlich
  aufwändiger, bewusst später und getrennt von Phase 1.
