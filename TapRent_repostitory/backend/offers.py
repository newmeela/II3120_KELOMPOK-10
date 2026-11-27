"""Penawaran, detail katalog, dan validasi foto penawaran."""
import base64
import binascii
import re
from datetime import date

DETAIL_COLUMNS = "id, name, description, daily_rate, available_from, available_until, terms, location, photo, active"
DEFAULT_TERMS = "Ambil dan kembalikan di titik penitipan, serta laporkan perubahan kondisi kepada petugas."
DEFAULT_LOCATION = "Titik penitipan TapRent ITB"


def migrate(db):
    item_columns = {row["name"] for row in db.execute("PRAGMA table_info(items)")}
    columns = {
        "active": "INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))",
        "terms": f"TEXT NOT NULL DEFAULT '{DEFAULT_TERMS}'",
        "location": f"TEXT NOT NULL DEFAULT '{DEFAULT_LOCATION}'",
        "photo": "TEXT",
    }
    for key, spec in columns.items():
        if key not in item_columns:
            db.execute(f"ALTER TABLE items ADD COLUMN {key} {spec}")
    booking_columns = {row["name"] for row in db.execute("PRAGMA table_info(bookings)")}
    if "accepted_terms" not in booking_columns:
        db.execute("ALTER TABLE bookings ADD COLUMN accepted_terms TEXT")


def valid_photo(value):
    if value is None or value == "":
        return None
    if not isinstance(value, str) or len(value) > 350_000:
        raise ValueError("Foto terlalu besar. Maksimum 250 KiB.")
    match = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)", value)
    if not match:
        raise ValueError("Gunakan gambar JPEG, PNG, atau WebP.")
    kind, body = match.groups()
    try:
        raw = base64.b64decode(body, validate=True)
    except binascii.Error as error:
        raise ValueError("Foto tidak valid.") from error
    valid = {
        "jpeg": raw.startswith(b"\xff\xd8\xff"),
        "png": raw.startswith(b"\x89PNG\r\n\x1a\n"),
        "webp": raw.startswith(b"RIFF") and raw[8:12] == b"WEBP",
    }
    if not valid[kind] or len(raw) > 250 * 1024:
        raise ValueError("Foto tidak valid atau melebihi 250 KiB.")
    return value


def parse(data):
    values = {}
    for key, limit in {"name":80, "description":600, "location":120, "terms":500,
                       "available_from":10, "available_until":10, "rfid_uid":64}.items():
        value = data.get(key)
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
            raise ValueError(f"Kolom {key} wajib diisi dan maksimum {limit} karakter.")
        values[key] = value.strip()
    first = date.fromisoformat(values["available_from"])
    last = date.fromisoformat(values["available_until"])
    if first >= last:
        raise ValueError("Batas akhir ketersediaan harus sesudah tanggal mulai.")
    values["available_from"], values["available_until"] = first.isoformat(), last.isoformat()
    rate = data.get("daily_rate")
    if type(rate) is not int or not 1 <= rate <= 100_000_000:
        raise ValueError("Tarif harian harus antara Rp1 dan Rp100.000.000.")
    values["daily_rate"] = rate
    values["rfid_uid"] = values["rfid_uid"].upper()
    if not re.fullmatch(r"[A-Z0-9:_-]+", values["rfid_uid"]):
        raise ValueError("UID RFID hanya boleh berisi huruf, angka, titik dua, strip, atau garis bawah.")
    if "photo" in data:
        values["photo"] = valid_photo(data["photo"])
    return values
