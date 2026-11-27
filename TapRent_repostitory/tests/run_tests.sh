#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
scratch=$(mktemp -d)
primary_pid=
cleanup() {
  if [[ -n "$primary_pid" ]]; then kill "$primary_pid" 2>/dev/null || true; fi
  rm -r "$scratch"
}
trap cleanup EXIT
port=${TAPRENT_TEST_PORT:-8912}
mkdir -p tests/evidence
export TAPRENT_DB="$scratch/primary.sqlite3"
export TAPRENT_DEVICE_KEY=test-key TAPRENT_DEVICE_TTL=4 TAPRENT_DEVICE_ID=MITRA_01 TAPRENT_AI_DISABLED=1
python3 - <<'FIXTURE'
from contextlib import closing
from backend import auth, main

main.init()
with closing(main.connect()) as db, db:
    assert db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
    auth.create_user(db, "mitra", "Petugas Uji", "mitra", "kata-sandi-uji")
FIXTURE
python3 app.py --port "$port" > "$scratch/primary.log" 2>&1 &
primary_pid=$!
for i in {1..30}; do
  if curl -fs "http://127.0.0.1:$port/" >/dev/null 2>&1; then break; fi
  sleep .15
done
TAPRENT_TEST_URL="http://127.0.0.1:$port" node tests/test_demo.cjs | tee tests/evidence/ringkasan_uji.txt
