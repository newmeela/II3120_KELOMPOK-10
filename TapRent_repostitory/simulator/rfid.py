"""Klien terminal untuk kontrak HTTP perangkat TapRent."""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4


def send(base_url, action, device_id, key, tag=None, event_id=None):
    route = "/api/v1/rfid/heartbeat" if action == "heartbeat" else "/api/v1/rfid/scans"
    data = {"device_id": device_id}
    if action == "scan":
        data.update(tag_uid=tag, scan_event_id=event_id or str(uuid4()),
                    scanned_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    request = Request(base_url.rstrip("/") + route, data=json.dumps(data).encode(),
                      headers={"Content-Type": "application/json", "X-Device-Key": key})
    try:
        response = urlopen(request, timeout=5)
    except HTTPError as error:
        response = error
    with response:
        return response.status, json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--device", default=os.getenv("TAPRENT_DEVICE_ID", "MITRA_01"))
    commands = parser.add_subparsers(dest="action", required=True)
    scan = commands.add_parser("scan", help="Kirim satu hasil pindai")
    scan.add_argument("tag")
    scan.add_argument("--event-id", help="Pakai ulang ID ini untuk uji duplikat")
    commands.add_parser("heartbeat", help="Kirim satu sinyal perangkat")
    args = parser.parse_args()
    key = os.getenv("TAPRENT_DEVICE_KEY")
    if not key:
        parser.error("Atur TAPRENT_DEVICE_KEY dengan nilai yang cocok dengan backend.")
    try:
        status, payload = send(args.url, args.action, args.device, key,
                               getattr(args, "tag", None), getattr(args, "event_id", None))
    except (URLError, TimeoutError) as error:
        print(f"Koneksi gagal: {error}", file=sys.stderr)
        return 1
    print(f"HTTP {status}")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return int(status >= 400)


if __name__ == "__main__":
    raise SystemExit(main())
