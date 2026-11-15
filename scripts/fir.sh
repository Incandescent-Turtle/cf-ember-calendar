#!/bin/bash
# Fir (Alliance) access from Windows Git Bash through scripts/fir_bridge.py (one Duo login).
#   scripts/fir.sh serve            # start in the background; approve the Duo push; wait for READY
#   scripts/fir.sh run 'cmd'        # remote command
#   scripts/fir.sh put LOCAL REMOTE # LOCAL as an absolute Windows path: "$(cygpath -wa file)"
#   scripts/fir.sh get REMOTE LOCAL
# Why: Alliance SSH needs Duo MFA per connection and OpenSSH ControlMaster does not work under
# Git for Windows, so a paramiko process keeps one authenticated connection and serves
# 127.0.0.1 only (token in scripts/bridge_token.txt, gitignored).
export MSYS_NO_PATHCONV=1 PYTHONIOENCODING=utf-8
UV=/c/Users/user/AppData/Local/Programs/Python/Python312/Scripts/uv.exe
B="$(cygpath -wa "$(dirname "$0")/fir_bridge.py")"
if [ "$1" = serve ]; then
  exec "$UV" run -q --no-project --with paramiko python -u "$B" serve fir.alliancecan.ca rorsmacd
fi
exec "$UV" run -q --no-project --with paramiko python "$B" "$@"
