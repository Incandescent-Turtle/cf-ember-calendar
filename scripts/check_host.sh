#!/usr/bin/env bash
# Check that the data host serves what the web needs: CORS (GET, HEAD, Range preflight),
# 206 Range responses, Content-Length, and no Content-Encoding on .bin.gz.
#
#   scripts/check_host.sh https://huggingface.co/datasets/<user>/<name>/resolve/main [ORIGIN]
set -uo pipefail
BASE="${1:?base url}"
ORIGIN="${2:-https://cf-ember-calendar.pages.dev}"
fail=0
ok()  { echo "  ok   $*"; }
bad() { echo "  FAIL $*"; fail=1; }

hdr() { curl -sSL -D - -o /dev/null -H "Origin: $ORIGIN" "$@" | tr -d '\r'; }
last() { awk 'BEGIN{IGNORECASE=1} /^HTTP\//{blk=""} {blk=blk $0 "\n"} END{printf "%s", blk}'; }

tile=$(curl -sSL "$BASE/manifest.json" | python -c "import json,sys;print(json.load(sys.stdin)['tiles'][0])" 2>/dev/null)
[ -n "$tile" ] && ok "manifest.json readable (first tile $tile)" || bad "manifest.json"
pt=$(curl -sSL "$BASE/manifest.json" | python -c "
import json,sys;m=json.load(sys.stdin)['points'];print(f\"{m['tiles'][0]}/{m['years'][1]}\" if m.get('tiles') else '')" 2>/dev/null)

for path in "cube/l01/$tile.bin.gz" "cube/l10/global.bin.gz" ${pt:+"points/$pt.parquet"}; do
  echo "$path"
  h=$(hdr -H "Range: bytes=0-99" "$BASE/$path" | last)
  echo "$h" | grep -qi '^HTTP/[0-9.]* 206' && ok "Range -> 206" || bad "Range not 206: $(echo "$h" | head -1)"
  echo "$h" | grep -qi '^content-range: bytes 0-99/' && ok "Content-Range" || bad "Content-Range"
  echo "$h" | grep -qi '^access-control-allow-origin: \(\*\|'"$ORIGIN"'\)' && ok "CORS on GET" || bad "CORS on GET"
  echo "$h" | grep -qi '^content-encoding:' && bad "Content-Encoding set: $(echo "$h" | grep -i '^content-encoding')" || ok "no Content-Encoding"
  h=$(curl -sSIL -H "Origin: $ORIGIN" "$BASE/$path" | tr -d '\r' | last)
  echo "$h" | grep -qi '^content-length: [0-9]' && ok "HEAD Content-Length" || bad "HEAD Content-Length"
  # preflight on every hop (the browser re-checks after a redirect)
  url="$BASE/$path"
  for hop in 1 2 3; do
    p=$(curl -sS -D - -o /dev/null -X OPTIONS -H "Origin: $ORIGIN" -H "Access-Control-Request-Method: GET" \
        -H "Access-Control-Request-Headers: range" "$url" | tr -d '\r')
    echo "$p" | grep -qi '^access-control-allow-headers: .*\(range\|\*\)' && ok "preflight allows Range (hop $hop)" \
      || bad "preflight hop $hop: $(echo "$p" | head -1)"
    next=$(curl -sS -o /dev/null -w '%{redirect_url}' -H "Range: bytes=0-99" "$url")
    [ -n "$next" ] || break
    url="$next"
  done
done
[ "$fail" = 0 ] && echo "host OK" || { echo "host check FAILED"; exit 1; }
