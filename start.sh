#!/usr/bin/env bash
# Startet das robolang-Entwickler-Hilfstool (Vite-Dev-Server) im Browser.
# Das ist NUR das Web-Hilfstool zum Testen der robolang<->Python-Übersetzung;
# die eigentliche App läuft später auf Android/Kotlin.
set -euo pipefail

cd "$(dirname "$0")"

# Abhaengigkeiten bei Bedarf installieren (erstes Mal / nach git pull).
if [ ! -d node_modules ]; then
  echo "node_modules fehlt — installiere Abhaengigkeiten …"
  npm install
fi

PORT="${PORT:-5173}"
echo "robolang-Dev-Server startet auf http://localhost:${PORT}/  (Strg+C beendet)"

# --open oeffnet den Standardbrowser; --host macht ihn auch im LAN erreichbar
# (z. B. zum Testen vom Handy aus).
exec npm run dev -- --port "${PORT}" --host --open
