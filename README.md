# II3120_KELOMPOK-10
# TAP RENT SEWA PINJAM

TapRent adalah prototipe penyewaan barang kampus untuk II3120, Kelompok K1–G10. Implementasi mengikuti wireframe Bab III revisi dan alur dari penawaran, pencarian, pengajuan, pembayaran simulasi, serah terima RFID, hingga pemeriksaan akhir.

## Jalankan aplikasi

Ekstrak arsip, buka terminal di folder TapRent, dan gunakan Python 3.10–3.13. Untuk menjalankan web dan pencarian cadangan:

```sh
python3 app.py
```

Buka http://127.0.0.1:8000. Di Windows, gunakan `py app.py` jika perintah `python3` tidak tersedia. Server dapat memakai port lain melalui `python3 app.py --port 8001`.

### Aktifkan Sentence Transformer

Contoh untuk Mac dan Linux. Buat lingkungan virtual, pasang dependensi AI, unduh model satu kali menggunakan koneksi internet, lalu mulai server dengan Python dari lingkungan virtual yang sama.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-ai.txt
.venv/bin/python -m ai.search
.venv/bin/python app.py
```

Di Windows, gunakan `.venv\Scripts\python.exe` untuk tiga perintah terakhir. Server hanya membaca model dari cache lokal saat pencarian, sehingga permintaan web tidak mengunduh model. Jika dependensi, model, atau inferensi tidak tersedia, web memakai SQL LIKE dan memberi label **Pencarian kata kunci cadangan**. Opsi `TAPRENT_AI_DISABLED=1` memaksa jalur cadangan untuk pengujian.

## Buat akun dan isi katalog

Database SQLite `taprent_revisi.sqlite3` terbentuk saat server pertama kali dinyalakan. Database baru mulai kosong. Gunakan tombol **Daftar akun**, pilih peran, isi formulir, lalu masuk menggunakan akun yang dibuat.

| Peran | Akses |
|---|---|
| Peminjam | Pencarian, katalog, pengajuan, pembayaran simulasi, kode pengambilan, dan pesanan miliknya |
| Penyewa (Pemilik Barang) | Penawaran miliknya, keputusan pengajuan, dan pemeriksaan akhir |
| Petugas Mitra | Dashboard RFID dan konfirmasi serah terima |

Akun Petugas Mitra dibuat secara lokal melalui terminal. Perintah meminta kata sandi dua kali tanpa menampilkannya:

```sh
python3 -m backend.provision petugas_itb "Petugas Mitra ITB"
```

Gunakan interpreter dan variabel `TAPRENT_DB` yang sama untuk server dan perintah ini jika database dikustomisasi. Kode internal lama `penyewa` dan `pemilik` dipertahankan pada SQLite agar relasi lama tetap bisa dibaca. API publik memakai `peminjam` dan `penyewa_pemilik`. Aplikasi versi ini menggunakan nama database baru secara default agar kredensial dari prototipe lama tidak ikut terpakai. Jika mengarahkan `TAPRENT_DB` ke salinan database lama, tinjau akun lama sebelum menggunakannya.

## Demo dari penawaran sampai selesai

1. Masuk sebagai Penyewa (Pemilik Barang). Buka **Pasang penawaran**. Isi nama **Tripod Aluminium**, deskripsi **Dudukan ponsel stabil untuk merekam video**, tarif Rp15.000 per hari, periode yang mencakup tanggal pencarian, titik penitipan, ketentuan, dan UID RFID unik, misalnya `TRIPOD01`. Foto opsional.
2. Masuk sebagai Peminjam. Cari **penyangga HP untuk rekam video**, pilih periode satu hari, isi anggaran Rp25.000. Saat model aktif, hasil kontekstual menunjukkan skor cosine similarity. Jika fallback aktif, gunakan kata kunci **tripod**.
3. Buka detail, pilih **Ajukan sewa**, dan setujui ketentuan. Pemilik menyetujui pengajuan; Peminjam menjalankan **Bayar simulasi** untuk memperoleh kode pengambilan.
4. Petugas Mitra memindai penitipan dan mengonfirmasi kondisi. Saat pengambilan, pindai kembali dan masukkan kode.
5. Saat pengembalian, petugas memindai dan mengonfirmasi penerimaan. Pemilik menyelesaikan pemeriksaan. Waktu terima dan waktu penyelesaian tercatat terpisah.

Untuk memperagakan peran bergantian, gunakan Keluar dan Masuk, atau buka akun berbeda pada profil browser yang berbeda. Contoh pada laporan adalah panduan tampilan dan alur; tangkapan layar aktual tersedia pada `tests/evidence/`.

## RFID dan pengujian

- Simulasi RFID tersedia pada dashboard Petugas Mitra. Rute perangkat menerima kredensial perangkat. Lihat [simulator](simulator/README.md).
- Kontrak API tersedia pada [OpenAPI](docs/openapi.json).
- Uji komponen: `python3 -m pip install -r requirements.txt`, kemudian `python3 -m pytest`.
- Uji browser: `npm install`, `npx playwright install chromium`, kemudian `bash tests/run_tests.sh`. Uji menggunakan database sementara, pendaftaran dua peran, dan skenario fallback. Uji adaptor model otomatis menggunakan embedding terkontrol.
- Uji model aktual setelah model tersimpan: `python3 -m tests.check_model`. Gunakan interpreter lingkungan AI. Uji mencetak skor aktual dan memeriksa bahwa Tripod Aluminium mengungguli barang pembanding.

Backend menggunakan pustaka standar Python. `web/` memuat UI responsif, `backend/` memuat aturan bisnis dan SQLite, `ai/` memuat model dan penilaian semantik, `simulator/` memuat klien RFID, dan `docs/report/` memuat laporan dan ringkasan pengujian. Dokumen dari iterasi sebelumnya menjadi arsip referensi. Pembayaran dan RFID pada bukti otomatis menggunakan simulasi.
