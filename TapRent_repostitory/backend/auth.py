"""Akun lokal dan sesi browser TapRent."""
import hashlib
import os
import re
import secrets
import time
from http.cookies import CookieError, SimpleCookie

COOKIE = "taprent_session"
SESSION_LIFETIME = 12 * 60 * 60
PUBLIC_ROLES = {"peminjam": "penyewa", "penyewa_pemilik": "pemilik"}
EXTERNAL_ROLES = {value: key for key, value in PUBLIC_ROLES.items()}


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)


def create_user(db, username, name, role, password):
    salt = secrets.token_bytes(16)
    return db.execute(
        "INSERT INTO users (username,name,role,salt,password_hash) VALUES (?,?,?,?,?)",
        (username, name, role, salt, password_hash(password, salt)),
    ).lastrowid


def init(db):
    for table, column in (("items", "owner_id"), ("bookings", "renter_id")):
        if column not in {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {column} INTEGER REFERENCES users(id)")


def public(user):
    return {**{field: user[field] for field in ("id", "username", "name")},
            "role": EXTERNAL_ROLES.get(user["role"], user["role"])}


def valid_registration(data):
    username, name, password = (data.get(key) for key in ("username", "name", "password"))
    if not all(isinstance(value, str) for value in (username, name, password)):
        return None
    username, name = username.strip().lower(), name.strip()
    if not re.fullmatch(r"[a-z0-9_]{3,24}", username) or not 2 <= len(name) <= 60 or not 8 <= len(password) <= 128:
        return None
    role = data.get("role")
    if not isinstance(role, str) or role not in PUBLIC_ROLES:
        return None
    return username, name, password, PUBLIC_ROLES[role]


def authenticate(db, data):
    username, password = data.get("username"), data.get("password")
    if not isinstance(username, str) or not isinstance(password, str) or len(username) > 64 or len(password) > 128:
        return None
    row = db.execute("SELECT * FROM users WHERE username = ?", (username.strip().lower(),)).fetchone()
    salt = row["salt"] if row else bytes(16)
    candidate = password_hash(password, salt)
    if row and secrets.compare_digest(candidate, row["password_hash"]):
        return row
    return None


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def end_session(db, token):
    if token:
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (digest(token),))


def start_session(db, user_id, old_token):
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
    end_session(db, old_token)
    db.execute("INSERT INTO sessions VALUES (?, ?, ?)", (digest(token), user_id, now + SESSION_LIFETIME))
    return token


def read_token(header):
    try:
        cookie = SimpleCookie(header or "")
        token = cookie.get(COOKIE)
        return token.value if token and re.fullmatch(r"[A-Za-z0-9_-]{43}", token.value) else None
    except CookieError:
        return None


def current_user(db, token):
    if token:
        return db.execute("""SELECT users.* FROM users JOIN sessions ON sessions.user_id = users.id
                            WHERE sessions.token_hash = ? AND sessions.expires_at > ?""",
                          (digest(token), int(time.time()))).fetchone()
    return None


def cookie_header(token):
    age = SESSION_LIFETIME if token else 0
    secure = "; Secure" if os.getenv("TAPRENT_SECURE_COOKIE") == "1" else ""
    return f"{COOKIE}={token or ''}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}{secure}"
