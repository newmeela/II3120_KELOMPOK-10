"""Buat akun Petugas Mitra secara lokal melalui terminal."""
import argparse
import sqlite3
from contextlib import closing
from getpass import getpass

from backend import auth, main


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("username")
    parser.add_argument("nama")
    args = parser.parse_args()
    password = getpass("Kata sandi Petugas Mitra: ")
    if getpass("Ulangi kata sandi: ") != password:
        parser.error("Konfirmasi kata sandi berbeda.")
    # Reuse validation of names and passwords without granting this role via HTTP.
    fields = auth.valid_registration(dict(username=args.username, name=args.nama,
                                           password=password, role="peminjam"))
    if not fields:
        parser.error("Gunakan username 3–24 karakter, nama 2–60 karakter, dan kata sandi 8–128 karakter.")
    main.init()
    try:
        with closing(main.connect()) as db, db:
            auth.create_user(db, *fields[:2], "mitra", password)
    except sqlite3.IntegrityError:
        parser.exit(1, "Username sudah digunakan.\n")
    print("Akun Petugas Mitra berhasil dibuat.")


if __name__ == "__main__":
    run()
