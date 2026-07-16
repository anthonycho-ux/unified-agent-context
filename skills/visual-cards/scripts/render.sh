#!/usr/bin/env bash
# render.sh <body-html-file> <output.png> [card-width-px] [tab-width] [tab-height]
# Fills the shared card template with the body fragment, opens it in the Orca
# browser via file://, screenshots it, writes PNG to output path.
set -euo pipefail
BODY_FILE="$1"; OUT="$2"; WIDTH="${3:-680}"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_BASE="$(mktemp /tmp/visual-card-XXXXXX)"
TMP_HTML="$TMP_BASE.html"
python3 - "$SKILL_DIR/assets/card.html" "$BODY_FILE" "$WIDTH" "$TMP_HTML" <<'PY'
import sys
tpl, body, width, out = sys.argv[1:5]
html = open(tpl).read().replace('{{WIDTH}}', width).replace('{{BODY}}', open(body).read())
open(out, 'w').write(html)
PY
PAGE=$(/usr/local/bin/orca tab create --url "file://$TMP_HTML" --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['browserPageId'])")
sleep 1
SHOT=""
for i in 1 2 3 4; do
  SHOT=$(/usr/local/bin/orca screenshot --page "$PAGE" --format png --json 2>/dev/null || true)
  if [ -n "$SHOT" ]; then break; fi
  sleep 1
done
printf '%s' "$SHOT" | python3 - "$OUT" <<'PY'
import json, sys, base64
d = json.load(sys.stdin)
b = d['result']['data']
if b.startswith('data:'): b = b.split(',', 1)[1]
open(sys.argv[1], 'wb').write(base64.b64decode(b))
print('saved', sys.argv[1])
PY
/usr/local/bin/orca tab close --page "$PAGE" --json >/dev/null 2>&1 || true
rm -f "$TMP_HTML" "$TMP_BASE"
