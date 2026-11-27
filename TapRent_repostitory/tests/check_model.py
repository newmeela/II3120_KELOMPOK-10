"""Pemeriksaan model nyata setelah cache siap."""
import tempfile
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path

from ai.search import cosine, embedding_vectors
from backend import auth, main


def run():
    labels = ["Tripod Aluminium", "Kalkulator Ilmiah", "Mikrofon Lavalier"]
    texts = [
        "penyangga HP untuk rekam video",
        "Tripod Aluminium. Dudukan ponsel yang stabil untuk merekam video.",
        "Kalkulator Ilmiah. Menghitung statistika dan matematika.",
        "Mikrofon Lavalier. Perangkat audio untuk wawancara.",
    ]
    mode, vectors = embedding_vectors(texts)
    ranks = sorted(zip(labels, (cosine(vectors[0], v) for v in vectors[1:])),
                   key=lambda row: row[1], reverse=True)
    for label, score in ranks:
        print(f"{mode} | {label} | {score:.4f}")
    assert ranks[0][0] == "Tripod Aluminium" and ranks[0][1] > 0.15
    with tempfile.TemporaryDirectory() as scratch:
        original = main.DB
        try:
            main.DB = str(Path(scratch) / "model.sqlite3")
            main.init()
            with closing(main.connect()) as db, db:
                owner = auth.create_user(db, "pemilik_uji", "Pemilik Uji", "pemilik", "kata-sandi-uji")
                start = datetime.now(main.JAKARTA).date()
                dates = {"starts": start.isoformat(), "ends": (start + timedelta(days=1)).isoformat()}
                item = main.save_offer(db, {
                    "name": labels[0], "description": "Dudukan ponsel yang stabil untuk merekam video.",
                    "daily_rate": 15000, "location": "Titik penitipan", "rfid_uid": "TAG-UJI",
                    "terms": "Kembalikan lengkap", "available_from": dates["starts"],
                    "available_until": dates["ends"],
                }, owner)
                query = {**dates, "q": texts[0], "budget": "25000"}
                result = main.search_items(db, query)
                assert result["mode"] == "sentence_transformer"
                assert result["items"][0]["id"] == item["id"]
                assert result["items"][0]["total"] == 15000
                assert not main.search_items(db, {**query, "budget": "10000"})["items"]
                renter = auth.create_user(db, "peminjam_uji", "Peminjam Uji", "penyewa", "kata-sandi-uji")
                main.create_booking(db, {**dates, "item_id": item["id"], "accept_terms": True}, renter)
                assert not main.search_items(db, query)["items"]
                print("LULUS · model aktual, penawaran SQLite, anggaran, dan konflik jadwal.")
        finally:
            main.DB = original


if __name__ == "__main__":
    run()
