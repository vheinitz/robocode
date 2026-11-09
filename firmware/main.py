# main.py — EeZear-Stil, OHNE Transpiler. Laeuft am ESP32 direkt; am PC als
# Simulation (siehe robopy.py). Ziel: wenig Tippen auf dem Handy — kurze Namen,
# Kurzform `.v = 1`, und in der App fuegt eine Icon-Tastatur ganze Tokens ein.
#
# Rechts der Kommentar zeigt das Icon/Token, mit dem die Zeile "getippt" wurde —
# die Emoji sind also nur Tasten, kein Code.

import robopy as r

LED = r.DO(13, "LED")            # 💡 DO(13)
BTN = r.BTN(2, "BTN")            # 🔲 BTN(2)   Pull-Up + invertiert + entprellt
POT = r.AIN(0, name="POT")      # 🎚️ AIN(0)   0..255
blink = r.Every(200)             # ⏱️ Every(200)

while True:                      # 🔁
    if BTN:                      # ❓ 🔲BTN          (bloße Referenz = gedrückt)
        LED.v = 1                #   💡=1            (Kurzform; EeZears DO13 = HIGH)
    elif POT.v > 180:            # ❓! 🎚️POT > 180   (0..255)
        LED.v = 0                #   💡=0
    elif blink.due:              # ❓! alle 200 ms
        LED.toggle()             #   💡~            (umschalten)
    r.sleep_ms(50)               # ⏱️ 50
