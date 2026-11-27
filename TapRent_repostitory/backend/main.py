import argparse
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from ai.search import cosine, embedding_vectors
from backend import auth, offers

BACKEND = Path(__file__).resolve().parent
ROOT = BACKEND.parent
DB = os.getenv("TAPRENT_DB", str(ROOT / "taprent_revisi.sqlite3"))
STATES = ["MENUNGGU_PERSETUJUAN", "DISETUJUI", "DIPESAN", "SIAP_DIAMBIL", "SEDANG_DIPINJAM",
          "MENUNGGU_PEMERIKSAAN", "SELESAI"]
SCAN_STATES = STATES[2:5]
JAKARTA = timezone(timedelta(hours=7))
DEVICE = os.getenv("TAPRENT_DEVICE_ID", "MITRA_01")
DEVICE_SEEN = {}
DEVICE_TTL = float(os.getenv("TAPRENT_DEVICE_TTL", "15"))
OVERLAP = """SELECT 1 FROM bookings b WHERE b.item_id = items.id
             AND b.status NOT IN ('SELESAI','DITOLAK','DIBATALKAN') AND b.starts < ? AND b.ends > ?"""


class APIError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def connect():
    db = sqlite3.connect(DB, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def now():
    return datetime.now(JAKARTA).isoformat(timespec="seconds")


def init():
    with closing(connect()) as db, db:
        db.executescript((BACKEND / "schema.sql").read_text())
        db.execute("BEGIN IMMEDIATE")
        auth.init(db)
        offers.migrate(db)


def field(data, name, limit=200):
    value = data.get(name)
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise APIError(400, f"Kolom {name} tidak valid.")
    return value.strip()


def interval(data):
    try:
        starts = date.fromisoformat(field(data, "starts", 10))
        ends = date.fromisoformat(field(data, "ends", 10))
    except ValueError as error:
        raise APIError(400, "Tanggal harus berformat YYYY-MM-DD.") from error
    if starts >= ends:
        raise APIError(400, "Tanggal akhir harus sesudah tanggal mulai.")
    return starts.isoformat(), ends.isoformat(), (ends - starts).days


def booking(db, identifier):
    row = db.execute("""SELECT bookings.*, items.name AS item_name, items.location, items.owner_id FROM bookings
                        JOIN items ON items.id = bookings.item_id WHERE bookings.id = ?""",
                     (identifier,)).fetchone()
    if row is None:
        raise APIError(404, "Pesanan tidak ditemukan.")
    payload = dict(row)
    payload["timeline"] = json.loads(row["timeline"])
    return payload


def transition(db, current, target, note=""):
    current["timeline"].append({"status": target, "timestamp": now(), "note": note})
    code = current["pickup_code"]
    if target == "DIPESAN":
        code = secrets.token_hex(4).upper()
    db.execute("UPDATE bookings SET status = ?, pickup_code = ?, timeline = ? WHERE id = ?",
               (target, code, json.dumps(current["timeline"]), current["id"]))
    return booking(db, current["id"])


def create_booking(db, data, renter_id):
    starts, ends, days = interval(data)
    if starts < datetime.now(JAKARTA).date().isoformat():
        raise APIError(400, "Tanggal mulai sudah lewat.")
    if data.get("accept_terms") is not True:
        raise APIError(400, "Setujui ketentuan sewa untuk melanjutkan.")
    item_id = data.get("item_id")
    if type(item_id) is not int:
        raise APIError(400, "item_id harus bilangan bulat.")
    item = db.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    if item is None or item["owner_id"] is None:
        raise APIError(404, "Barang tidak ditemukan.")
    if "expected_terms" in data and data["expected_terms"] != item["terms"]:
        raise APIError(409, "Ketentuan berubah. Perbarui halaman dan tinjau kembali.")
    available = db.execute(f"""SELECT 1 FROM items WHERE id = ? AND active = 1 AND available_from <= ?
        AND available_until >= ? AND NOT EXISTS ({OVERLAP})""", (item_id, starts, ends, ends, starts)).fetchone()
    if not available:
        raise APIError(409, "SCHEDULE_CONFLICT")
    identifier = db.execute("""INSERT INTO bookings (item_id, starts, ends, total, status, timeline, renter_id, accepted_terms)
              VALUES (?, ?, ?, ?, 'MENUNGGU_PERSETUJUAN', ?, ?, ?)""", (item_id, starts, ends, item["daily_rate"] * days,
              json.dumps([{"status": "MENUNGGU_PERSETUJUAN", "timestamp": now(), "note": "Pengajuan diterima"}]), renter_id, item["terms"])).lastrowid
    return booking(db, identifier)


def search_items(db, query):
    keyword = field(query, "q")
    starts, ends, days = interval(query)
    try:
        budget = int(field(query, "budget", 12))
        if budget < 1:
            raise ValueError
    except ValueError as error:
        raise APIError(400, "Anggaran harus berupa bilangan bulat positif.") from error
    if starts < datetime.now(JAKARTA).date().isoformat():
        raise APIError(400, "Tanggal mulai sudah lewat.")
    sql = f"""SELECT {offers.DETAIL_COLUMNS} FROM items
             WHERE active = 1 AND owner_id IS NOT NULL AND available_from <= ? AND available_until >= ?
             AND daily_rate * ? <= ? AND NOT EXISTS ({OVERLAP})"""
    params = (starts, ends, days, budget, ends, starts)
    items = [dict(row) for row in db.execute(sql, params)]
    try:
        if not items:
            return {"mode": "no_candidates", "items": [], "criteria": {"starts": starts, "ends": ends, "days": days, "budget": budget}}
        mode, vectors = embedding_vectors([keyword] + [f"{row['name']} {row['description']}" for row in items])
        for item, vector in zip(items, vectors[1:]):
            item["score"] = round(cosine(vectors[0], vector), 4)
        items = sorted((item for item in items if item["score"] > 0.15), key=lambda item: (-item["score"], item["daily_rate"], item["id"]))
        if not items and mode == "semantic_local":
            raise LookupError
    except (OSError, KeyError, TypeError, ValueError, LookupError, RuntimeError):
        mode = "keyword_fallback"
        terms = list(dict.fromkeys(word for word in re.findall(r"[^\W_]+", keyword.lower()) if len(word) >= 2 and word not in {"untuk", "buat", "saya", "yang", "dengan", "butuh"}))
        if terms:
            match = " OR ".join(["lower(name || ' ' || description) LIKE ?"] * len(terms))
            items = [dict(row) for row in db.execute(sql + " AND (" + match + ")",
                                                    (*params, *(f"%{word}%" for word in terms)))]
        else:
            items = []
    for item in items:
        item["total"] = item["daily_rate"] * days
    return {"mode": mode, "items": items, "criteria": {"starts": starts, "ends": ends, "days": days, "budget": budget}}


def scan(db, data):
    event = field(data, "event_id", 100)
    tag = field(data, "tag_id", 64).upper()
    device = field(data, "device_id", 64)
    if device != DEVICE:
        raise APIError(403, "Perangkat tidak terdaftar.")
    existing = db.execute("SELECT * FROM iot_logs WHERE event_id = ?", (event,)).fetchone()
    if existing:
        if (existing["tag_id"], existing["device_id"]) != (tag, device):
            raise APIError(409, "event_id sudah dipakai payload lain.")
        return 409, {"event": dict(existing), "duplicate": True, "error": "DUPLICATE_SCAN_EVENT"}
    registered = db.execute("SELECT 1 FROM items WHERE rfid_uid = ?", (tag,)).fetchone()
    candidates = db.execute("""SELECT bookings.id, bookings.status FROM bookings
        JOIN items ON items.id = bookings.item_id WHERE items.rfid_uid = ?
        AND (status IN ('SIAP_DIAMBIL','SEDANG_DIPINJAM') OR (status = 'DIPESAN' AND ends >= ?))
        ORDER BY CASE WHEN status = 'DIPESAN' THEN 1 ELSE 0 END, starts, bookings.id""",
        (tag, datetime.now(JAKARTA).date().isoformat())).fetchall()
    current = candidates[0] if candidates else None
    previous = None
    if current:
        previous = db.execute("""SELECT * FROM iot_logs WHERE booking_id = ? AND stage = ?
          AND result = 'VALID' AND confirmed_at IS NULL ORDER BY rowid DESC LIMIT 1""",
          (current["id"], current["status"])).fetchone()
    result = "TAG_NOT_REGISTERED"
    if registered:
        result = "VALID" if current and not previous else "DOUBLE_TAP" if previous else "TAG_TRANSACTION_MISMATCH"
    db.execute("INSERT INTO iot_logs VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
               (event, tag, device, data.get("scanned_at", now()), current["id"] if current else None,
                current["status"] if current else None, result))
    row = db.execute("SELECT * FROM iot_logs WHERE event_id = ?", (event,)).fetchone()
    return {"VALID": 201, "DOUBLE_TAP": 409, "TAG_NOT_REGISTERED": 422, "TAG_TRANSACTION_MISMATCH": 422}[result], {"event": dict(row), "duplicate": False}


def confirm_scan(db, data):
    event = field(data, "event_id", 100)
    condition = field(data, "condition")
    log = db.execute("SELECT * FROM iot_logs WHERE event_id = ?", (event,)).fetchone()
    if not log or log["result"] != "VALID" or log["confirmed_at"]:
        raise APIError(409, "Pindai valid yang belum dikonfirmasi diperlukan.")
    current = booking(db, log["booking_id"])
    if current["status"] != log["stage"] or current["status"] not in SCAN_STATES:
        raise APIError(409, "Pindai berasal dari tahap lain.")
    if current["status"] == "SIAP_DIAMBIL" and not secrets.compare_digest(
            field(data, "pickup_code", 32).upper().encode(), current["pickup_code"].encode()):
        raise APIError(422, "INVALID_PICKUP_CODE")
    db.execute("UPDATE iot_logs SET confirmed_at = ? WHERE event_id = ?", (now(), event))
    return transition(db, current, STATES[STATES.index(current["status"]) + 1], condition)


def visible_booking(order, user):
    order.pop("owner_id", None)
    order.pop("renter_id", None)
    if user["role"] != "penyewa":
        order.pop("pickup_code", None)
    return order


def save_offer(db, data, owner_id, offer_id=None):
    try:
        details = offers.parse(data)
    except ValueError as error:
        raise APIError(400, str(error)) from error
    if offer_id is not None:
        current = db.execute("SELECT * FROM items WHERE id = ? AND owner_id = ?", (offer_id, owner_id)).fetchone()
        if not current:
            raise APIError(404, "Penawaran tidak ditemukan.")
        active = db.execute("""SELECT 1 FROM bookings WHERE item_id = ?
                      AND status NOT IN ('SELESAI','DITOLAK','DIBATALKAN') LIMIT 1""", (offer_id,)).fetchone()
        if active and any(current[key] != details[key] for key in
                          ("rfid_uid", "location", "available_from", "available_until")):
            raise APIError(409, "UID, lokasi, dan jadwal terkunci selama ada transaksi aktif.")
    try:
        if offer_id is None:
            details["owner_id"] = owner_id
            names = ", ".join(details)
            placeholders = ", ".join("?" for _ in details)
            offer_id = db.execute(f"INSERT INTO items ({names}) VALUES ({placeholders})", tuple(details.values())).lastrowid
        else:
            assignments = ", ".join(f"{key} = ?" for key in details)
            db.execute(f"UPDATE items SET {assignments} WHERE id = ?", (*details.values(), offer_id))
    except sqlite3.IntegrityError as error:
        raise APIError(409, "UID RFID sudah terdaftar pada barang lain.") from error
    return dict(db.execute(f"SELECT {offers.DETAIL_COLUMNS}, rfid_uid FROM items WHERE id = ?", (offer_id,)).fetchone())


def dispatch(db, method, path, query, data, user):
    role = user["role"]
    user_id = user["id"]
    if method == "GET":
        if path == "/api/config":
            return 200, {"device_id": DEVICE}
        if path == "/api/items":
            columns = offers.DETAIL_COLUMNS + (", rfid_uid" if role == "mitra" else "")
            scope = "WHERE active = 1 AND owner_id IS NOT NULL" if role != "mitra" else ""
            return 200, [dict(row) for row in db.execute(f"SELECT {columns} FROM items {scope} ORDER BY id")]
        if path == "/api/offers" and role == "pemilik":
            return 200, [dict(row) for row in db.execute(
                f"SELECT {offers.DETAIL_COLUMNS}, rfid_uid FROM items WHERE owner_id = ? ORDER BY id", (user_id,))]
        if path == "/api/items/search":
            return 200, search_items(db, query)
        if path == "/api/bookings":
            scope, args = {
                "penyewa": ("WHERE b.renter_id = ?", (user_id,)),
                "pemilik": ("WHERE i.owner_id = ?", (user_id,)),
                "mitra": ("WHERE b.status IN ('DIPESAN','SIAP_DIAMBIL','SEDANG_DIPINJAM','MENUNGGU_PEMERIKSAAN','SELESAI')", ()),
            }[role]
            rows = db.execute(f"SELECT b.id FROM bookings b JOIN items i ON i.id = b.item_id {scope} ORDER BY b.id DESC", args)
            return 200, [visible_booking(booking(db, row["id"]), user) for row in rows]
        if path == "/api/iot/status" and role == "mitra":
            seen = DEVICE_SEEN.get(DEVICE)
            return 200, {"device_id": DEVICE, "online": seen is not None and time.monotonic() - seen < DEVICE_TTL}
        if path == "/api/iot/logs":
            if role != "mitra":
                raise APIError(403, "Akses petugas diperlukan.")
            return 200, [dict(row) for row in db.execute("SELECT * FROM iot_logs ORDER BY rowid DESC LIMIT 50")]
    elif method == "POST":
        db.execute("BEGIN IMMEDIATE")
        if path == "/api/offers" and role == "pemilik":
            return 201, save_offer(db, data, user_id)
        offer_action = path.strip("/").split("/")
        if role == "pemilik" and len(offer_action) == 4 and offer_action[:2] == ["api", "offers"] and offer_action[2].isdigit():
            offer_id = int(offer_action[2])
            if offer_action[3] == "edit":
                return 200, save_offer(db, data, user_id, offer_id)
            if offer_action[3] == "visibility" and type(data.get("active")) is bool:
                count = db.execute("UPDATE items SET active = ? WHERE id = ? AND owner_id = ?",
                                   (data["active"], offer_id, user_id)).rowcount
                if not count:
                    raise APIError(404, "Penawaran tidak ditemukan.")
                return 200, {"active": data["active"]}
        if path == "/api/bookings" and role == "penyewa":
            return 201, visible_booking(create_booking(db, data, user_id), user)
        if path == "/api/iot/scan" and role == "mitra":
            return scan(db, data)
        if path == "/api/iot/confirm" and role == "mitra":
            return 200, visible_booking(confirm_scan(db, data), user)
        parts = path.strip("/").split("/")
        if len(parts) == 4 and parts[:2] == ["api", "bookings"] and parts[2].isdigit():
            current = booking(db, int(parts[2]))
            if role == "mitra":
                raise APIError(403, "Aksi khusus Penyewa atau Pemilik.")
            if (role == "penyewa" and current["renter_id"] != user_id
                    or role == "pemilik" and current["owner_id"] != user_id):
                raise APIError(404, "Pesanan tidak ditemukan.")
            action = parts[3]
            if action not in {"penyewa": {"pay", "cancel"}, "pemilik": {"approve", "reject", "finish"}}[role]:
                raise APIError(403, "Aksi tidak tersedia untuk peran ini.")
            if role == "pemilik" and action == "approve" and current["status"] == "MENUNGGU_PERSETUJUAN":
                return 200, visible_booking(transition(db, current, "DISETUJUI", "Pemilik menyetujui pengajuan"), user)
            if role == "pemilik" and action == "finish" and current["status"] == "MENUNGGU_PEMERIKSAAN":
                return 200, visible_booking(transition(db, current, "SELESAI", field(data, "condition")), user)
            if role == "penyewa" and action == "pay" and current["status"] == "DISETUJUI":
                if data.get("simulation") is not True:
                    raise APIError(400, "Pembayaran harus berlabel simulasi.")
                return 200, visible_booking(transition(db, current, "DIPESAN", "Pembayaran simulasi tercatat"), user)
            if role == "pemilik" and action == "reject" and current["status"] == "MENUNGGU_PERSETUJUAN":
                return 200, visible_booking(transition(db, current, "DITOLAK", "Pengajuan ditolak pemilik"), user)
            if role == "penyewa" and action == "cancel" and current["status"] in STATES[:3]:
                return 200, visible_booking(transition(db, current, "DIBATALKAN", "Reservasi dibatalkan sebelum penitipan"), user)
            raise APIError(409, "Aksi tidak sesuai status pesanan.")
        raise APIError(403, "Aksi tidak tersedia untuk peran ini.")
    raise APIError(404, "Endpoint tidak ditemukan.")


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, payload, mime="application/json; charset=utf-8", cookie=None):
        raw = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(raw)

    def handle_request(self):
        url = urlsplit(self.path)
        try:
            static = {"/": ("index.html", "text/html"), "/style.css": ("style.css", "text/css"),
                      "/ui.js": ("ui.js", "text/javascript")}
            if self.command == "GET" and url.path in static:
                name, mime = static[url.path]
                self.respond(200, (ROOT / "web" / name).read_bytes(), f"{mime}; charset=utf-8")
                return
            if self.command == "POST" and self.headers.get_content_type() != "application/json":
                raise APIError(415, "Gunakan Content-Type application/json.")
            data = {}
            if self.command == "POST":
                size = int(self.headers.get("Content-Length", "0"))
                limit = 370_000 if url.path == "/api/offers" or url.path.startswith("/api/offers/") else 8192
                if size < 0 or size > limit:
                    raise APIError(413, "Muatan terlalu besar.")
                data = json.loads(self.rfile.read(size)) if size else {}
                if not isinstance(data, dict):
                    raise APIError(400, "Data harus berupa objek JSON.")
            path = url.path
            device_scan = False
            if self.command == "POST" and path in {"/api/v1/rfid/scans", "/api/v1/rfid/heartbeat"}:
                key = os.getenv("TAPRENT_DEVICE_KEY")
                supplied = self.headers.get("X-Device-Key", "")
                if not key or not secrets.compare_digest(supplied.encode(), key.encode()):
                    raise APIError(401, "DEVICE_UNAUTHORIZED")
                if field(data, "device_id", 64) != DEVICE:
                    raise APIError(403, "Perangkat tidak terdaftar.")
                if path.endswith("/heartbeat"):
                    DEVICE_SEEN[DEVICE] = time.monotonic()
                    self.respond(200, {"device_id": DEVICE, "online": True})
                    return
                scanned_at = field(data, "scanned_at", 40)
                if datetime.fromisoformat(scanned_at).utcoffset() is None:
                    raise APIError(400, "scanned_at harus menyertakan zona waktu.")
                data = {"device_id": data.get("device_id"), "tag_id": data.get("tag_uid"),
                        "event_id": data.get("scan_event_id"), "scanned_at": scanned_at}
                DEVICE_SEEN[DEVICE] = time.monotonic()
                device_scan = True
            elif path == "/api/iot/scan":
                data.pop("scanned_at", None)
            query = {key: values[0] for key, values in parse_qs(url.query).items()}
            token = auth.read_token(self.headers.get("Cookie"))
            cookie = None
            with closing(connect()) as db, db:
                if device_scan:
                    db.execute("BEGIN IMMEDIATE")
                    status, result = scan(db, data)
                elif path == "/api/auth/login" and self.command == "POST":
                    user = auth.authenticate(db, data)
                    if user is None:
                        raise APIError(401, "Username atau kata sandi salah.")
                    cookie = auth.cookie_header(auth.start_session(db, user["id"], token))
                    status, result = 200, auth.public(user)
                elif path == "/api/auth/register" and self.command == "POST":
                    fields = auth.valid_registration(data)
                    if fields is None:
                        raise APIError(400, "Isi nama, username 3–24 karakter, kata sandi 8–128 karakter, dan pilih peran publik yang valid.")
                    username, name, password, role = fields
                    try:
                        user_id = auth.create_user(db, username, name, role, password)
                    except sqlite3.IntegrityError as error:
                        raise APIError(409, "Username sudah digunakan.") from error
                    user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                    status, result = 201, auth.public(user)
                elif path == "/api/auth/logout" and self.command == "POST":
                    auth.end_session(db, token)
                    cookie = auth.cookie_header(None)
                    status, result = 200, {"ok": True}
                else:
                    user = auth.current_user(db, token)
                    if user is None:
                        raise APIError(401, "Silakan masuk untuk melanjutkan.")
                    if path == "/api/auth/me" and self.command == "GET":
                        status, result = 200, auth.public(user)
                    else:
                        status, result = dispatch(db, self.command, path, query, data, user)
            self.respond(status, result, cookie=cookie)
        except APIError as error:
            self.respond(error.status, {"error": str(error)})
        except (ValueError, UnicodeError):
            self.respond(400, {"error": "Format data tidak valid."})
        except sqlite3.OperationalError:
            self.respond(503, {"error": "Basis data sedang tidak tersedia. Coba lagi."})

    do_GET = do_POST = handle_request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    args = parser.parse_args()
    init()
    print(f"TapRent berjalan di http://{args.host}:{args.port}", flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
