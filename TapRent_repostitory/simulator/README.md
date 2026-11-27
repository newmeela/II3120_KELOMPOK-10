# Simulator perangkat RFID TapRent

Simulator web tersedia pada tampilan Petugas Mitra. Klien terminal di sini mengirim payload melalui rute perangkat dan memakai kunci yang sama dengan server.

Jalankan backend dan klien di terminal terpisah dengan TAPRENT_DEVICE_KEY yang sama. Contoh untuk shell macOS atau Linux:

```bash
TAPRENT_DEVICE_KEY=kunci-demo python3 app.py
TAPRENT_DEVICE_KEY=kunci-demo python3 -m simulator.rfid heartbeat
TAPRENT_DEVICE_KEY=kunci-demo python3 -m simulator.rfid scan TRIPOD01 --event-id demo-001
```

Siapkan penawaran Tripod Aluminium ber-UID TRIPOD01 dan pesanan terkait yang telah dibayar simulasi sebelum memindai tag TRIPOD01. Ulangi event demo-001 untuk melihat HTTP 409. Tombol konfirmasi di web Petugas Mitra mengubah status transaksi. Indikator koneksi kembali offline setelah ambang tunggu jika sinyal berhenti. Perintah heartbeat mengirim satu sinyal dan langsung selesai.
